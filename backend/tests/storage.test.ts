import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import request from 'supertest';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';
import { app } from '../server';
import { config, getDatabase, setTestDatabase, closeDatabase, parseStorageNodes, parseStorageKey } from '../config';
import { StorageService } from '../services/storage';
import { openBlob, rankNodes, sealBlob } from '../services/storage/crypto';
import { signRequest } from '../services/storage/sigv4';
import { S3Provider } from '../services/storage/s3';
import { DirectoryProvider } from '../services/storage/directory';
import { FakeS3, startFakeS3 } from './helpers/fakeS3';
import { FakeNode, startFakeNode } from './helpers/fakeNode';

const KEY = crypto.randomBytes(32);

describe('Encrypted blob crypto', () => {
  it('round-trips data and metadata without leaking plaintext', () => {
    const secret = Buffer.from('Témoignage très sensible '.repeat(20));
    const sealed = sealBlob(KEY, secret, { mimeType: 'image/png' });
    expect(sealed.includes(secret.subarray(0, 30))).toBe(false);
    expect(sealed.includes(Buffer.from('image/png'))).toBe(false);
    const opened = openBlob(KEY, sealed);
    expect(opened.data.equals(secret)).toBe(true);
    expect(opened.meta.mimeType).toBe('image/png');
  });

  it('uses a different ciphertext each time and rejects wrong keys or tampering', () => {
    const data = Buffer.from('abc');
    const a = sealBlob(KEY, data);
    const b = sealBlob(KEY, data);
    expect(a.equals(b)).toBe(false);
    expect(() => openBlob(crypto.randomBytes(32), a)).toThrow(/Déchiffrement/);
    const tampered = Buffer.from(a);
    tampered[tampered.length - 1] ^= 1;
    expect(() => openBlob(KEY, tampered)).toThrow(/altéré/);
    expect(() => openBlob(KEY, Buffer.from('nope'))).toThrow();
  });

  it('places blobs deterministically and moves few of them when a node is added', () => {
    const nodes = ['a', 'b', 'c'].map((name) => ({ name }));
    const more = [...nodes, { name: 'd' }];
    let moved = 0;
    for (let i = 0; i < 200; i += 1) {
      const id = crypto.randomBytes(8).toString('hex');
      expect(rankNodes(nodes, id).map((n) => n.name)).toEqual(rankNodes(nodes, id).map((n) => n.name));
      if (rankNodes(nodes, id)[0].name !== rankNodes(more, id)[0].name) moved += 1;
    }
    expect(moved).toBeLessThan(100);
  });
});

describe('AWS Signature V4', () => {
  it('matches the official AWS "GET Object" example signature', () => {
    const authorization = signRequest({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'),
      headers: {
        Range: 'bytes=0-9',
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
    });
    expect(authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, ' +
        'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, ' +
        'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41'
    );
  });

  it('matches the official AWS "GET Bucket (List Objects)" example signature', () => {
    const authorization = signRequest({
      method: 'GET',
      url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'),
      headers: {
        'x-amz-content-sha256': 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
        'x-amz-date': '20130524T000000Z',
      },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1',
      amzDate: '20130524T000000Z',
    });
    expect(authorization).toContain('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
});

describe('Storage configuration', () => {
  const token = 'a'.repeat(32);

  it('validates S3 and directory sources', () => {
    const [s3, dir] = parseStorageNodes(
      JSON.stringify([
        { type: 's3', name: 'b2', endpoint: 'https://s3.us-west-004.backblazeb2.com/', bucket: 'akab-blobs',
          accessKeyId: 'id', secretAccessKey: 'secret', prefix: '/prod/' },
        { type: 'directory', name: 'nas', path: '/mnt/nas/akab' },
      ])
    );
    expect(s3).toMatchObject({ type: 's3', region: 'us-east-1', prefix: 'prod/', pathStyle: true,
      endpoint: 'https://s3.us-west-004.backblazeb2.com' });
    expect(dir).toEqual({ type: 'directory', name: 'nas', path: '/mnt/nas/akab' });

    const bad = (entry: object) => () => parseStorageNodes(JSON.stringify([entry]));
    expect(bad({ type: 's3', name: 'x', endpoint: 'https://h', bucket: 'ab', accessKeyId: 'i', secretAccessKey: 's' })).toThrow(/bucket/);
    expect(bad({ type: 's3', name: 'x', endpoint: 'https://h', bucket: 'valid-bucket', accessKeyId: 'i' })).toThrow(/secretAccessKey/);
    expect(bad({ type: 'directory', name: 'x', path: 'relative/dir' })).toThrow(/absolu/);
    expect(bad({ type: 'ftp', name: 'x' })).toThrow(/type inconnu/);
  });

  it('validates STORAGE_NODES', () => {
    expect(parseStorageNodes(undefined)).toEqual([]);
    expect(parseStorageNodes(JSON.stringify([{ name: 'paris', url: 'http://h:7000/', token }]))).toEqual([
      { type: 'http', name: 'paris', url: 'http://h:7000', token },
    ]);
    expect(() => parseStorageNodes('not json')).toThrow(/JSON/);
    expect(() => parseStorageNodes(JSON.stringify([{ name: 'a', url: 'ftp://h', token }]))).toThrow(/http/);
    expect(() => parseStorageNodes(JSON.stringify([{ name: 'a', url: 'http://h', token: 'short' }]))).toThrow(/token/);
    expect(() =>
      parseStorageNodes(JSON.stringify([{ name: 'a', url: 'http://h', token }, { name: 'a', url: 'http://i', token }]))
    ).toThrow(/double/);
  });

  it('requires a valid encryption key when nodes are configured', () => {
    const nodes = parseStorageNodes(JSON.stringify([{ name: 'a', url: 'http://h', token }]));
    expect(() => parseStorageKey(undefined, nodes)).toThrow(/STORAGE_ENCRYPTION_KEY/);
    expect(() => parseStorageKey('zz', nodes)).toThrow(/64/);
    expect(parseStorageKey(undefined, [])).toBeNull();
    expect(parseStorageKey('ab'.repeat(32), nodes)?.length).toBe(32);
  });
});

describe('Replicated storage nodes', () => {
  let nodes: FakeNode[];
  let adminToken: string;
  const original = { ...config.storage };

  beforeAll(async () => {
    setTestDatabase(new Database(':memory:'));
    nodes = await Promise.all(['alpha', 'beta', 'gamma'].map(startFakeNode));
    adminToken = (
      await request(app).post('/api/auth/login').send({
        email: config.adminDefault.email,
        password: config.adminDefault.password,
      })
    ).body.token;
  });

  beforeEach(() => {
    nodes.forEach((node) => {
      node.down = false;
    });
    config.storage.nodes = nodes.map(({ name, url, token }) => ({ name, url, token }));
    config.storage.encryptionKey = KEY;
    config.storage.replicas = 2;
    config.storage.writeQuorum = 1;
    config.storage.timeoutMs = 2000;
  });

  afterAll(async () => {
    Object.assign(config.storage, original);
    await Promise.all(nodes.map((node) => node.close()));
    closeDatabase();
  });

  const holders = (ref: string) => nodes.filter((node) => node.blobs.has(ref.replace('akab-', '')));

  it('stores only ciphertext on exactly the configured number of nodes and reads it back', async () => {
    const data = Buffer.from('preuve confidentielle '.repeat(50));
    const { ref } = await StorageService.store(data, { mimeType: 'image/jpeg' });

    expect(ref).toMatch(/^akab-[0-9a-f]{64}$/);
    expect(holders(ref)).toHaveLength(2);
    for (const node of holders(ref)) {
      expect(node.blobs.get(ref.slice(5))!.includes(data.subarray(0, 40))).toBe(false);
    }
    const back = await StorageService.retrieve(ref);
    expect(back!.data.equals(data)).toBe(true);
    expect(back!.meta.mimeType).toBe('image/jpeg');
  });

  it('survives the loss of a replica and ignores corrupted copies', async () => {
    const data = crypto.randomBytes(500);
    const { ref } = await StorageService.store(data, {});
    const [first, second] = holders(ref);

    first.down = true;
    expect((await StorageService.retrieve(ref))!.data.equals(data)).toBe(true);

    first.down = false;
    first.blobs.set(ref.slice(5), crypto.randomBytes(300));
    expect((await StorageService.retrieve(ref))!.data.equals(data)).toBe(true);

    first.blobs.delete(ref.slice(5));
    second.down = true;
    expect(await StorageService.retrieve(ref)).toBeNull();
  });

  it('enforces the write quorum', async () => {
    config.storage.writeQuorum = 2;
    const data = crypto.randomBytes(100);
    nodes[0].down = true;
    nodes[1].down = true;
    await expect(StorageService.store(data, {})).rejects.toThrow(/indisponible/);

    nodes[2].down = true;
    config.storage.writeQuorum = 1;
    await expect(StorageService.store(crypto.randomBytes(100), {})).rejects.toThrow(/indisponible/);
  });

  it('repairs missing replicas and reports unreachable nodes', async () => {
    const { ref } = await StorageService.store(crypto.randomBytes(400), {});
    const [victim] = holders(ref);
    victim.blobs.delete(ref.slice(5));
    expect(holders(ref)).toHaveLength(1);

    const report = await StorageService.repair();
    expect(report.copied).toBeGreaterThanOrEqual(1);
    expect(report.unreachableNodes).toEqual([]);
    expect(holders(ref)).toHaveLength(2);

    nodes[2].down = true;
    expect((await StorageService.repair()).unreachableNodes).toEqual(['gamma']);
  });

  it('backs up the encrypted database and restores the newest snapshot from the nodes alone', async () => {
    const db = getDatabase();
    db.exec("CREATE TABLE IF NOT EXISTS probe (value TEXT); INSERT INTO probe VALUES ('v1');");
    await StorageService.backupDatabase();
    db.exec("INSERT INTO probe VALUES ('v2');");
    const second = await StorageService.backupDatabase();

    for (const node of nodes) {
      for (const pointer of node.pointers.values()) {
        expect(pointer.includes(Buffer.from(second.blobId))).toBe(false);
      }
    }

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akab-restore-'));
    const destination = path.join(dir, 'restored.sqlite');
    const restored = await StorageService.restoreLatestBackup(destination);
    expect(restored.blobId).toBe(second.blobId);

    const copy = new Database(destination, { readonly: true });
    expect(copy.prepare('SELECT value FROM probe ORDER BY rowid').all()).toEqual([{ value: 'v1' }, { value: 'v2' }]);
    copy.close();
    fs.rmSync(dir, { recursive: true, force: true });

    config.storage.encryptionKey = crypto.randomBytes(32);
    await expect(StorageService.restoreLatestBackup(destination)).rejects.toThrow(/Aucune sauvegarde/);
  });

  it('serves evidence through the gateway with a safe content type', async () => {
    const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
    const upload = await request(app)
      .post('/api/signals/upload-proof')
      .set('x-bypass-ratelimit', 'true')
      .attach('file', png, { filename: 'p.png', contentType: 'image/png' });
    expect(upload.status).toBe(201);
    const cid = upload.body.evidence.cid;
    expect(cid).toMatch(/^akab-/);

    const fetched = await request(app).get(`/api/ipfs/${cid}`).buffer(true).parse((res, cb) => {
      const parts: Buffer[] = [];
      res.on('data', (c: Buffer) => parts.push(c));
      res.on('end', () => cb(null, Buffer.concat(parts)));
    });
    expect(fetched.status).toBe(200);
    expect(fetched.headers['content-type']).toContain('image/png');
    expect(fetched.headers['x-content-type-options']).toBe('nosniff');
    expect((fetched.body as Buffer).equals(png)).toBe(true);

    const html = await StorageService.store(Buffer.from('<script>alert(1)</script>'), { mimeType: 'text/html' });
    const risky = await request(app).get(`/api/ipfs/${html.ref}`);
    expect(risky.headers['content-type']).toContain('application/octet-stream');
    expect(risky.headers['content-disposition']).toBe('attachment');

    expect((await request(app).get('/api/ipfs/akab-' + 'a'.repeat(64))).status).toBe(404);

    nodes.forEach((node) => (node.down = true));
    expect((await request(app).post('/api/signals/upload-proof').set('x-bypass-ratelimit', 'true')
      .attach('file', png, { filename: 'p.png', contentType: 'image/png' })).status).toBe(503);
  });

  it('exposes node health and maintenance to administrators only', async () => {
    nodes[1].down = true;
    const status = await request(app).get('/api/admin/storage').set('Authorization', 'Bearer ' + adminToken);
    expect(status.status).toBe(200);
    expect(status.body.enabled).toBe(true);
    expect(status.body.nodes.map((n: any) => [n.name, n.reachable])).toEqual([
      ['alpha', true],
      ['beta', false],
      ['gamma', true],
    ]);
    expect(JSON.stringify(status.body)).not.toContain(nodes[0].token);

    nodes[1].down = false;
    const repair = await request(app).post('/api/admin/storage/repair').set('Authorization', 'Bearer ' + adminToken);
    expect(repair.status).toBe(200);
    const backup = await request(app).post('/api/admin/storage/backup').set('Authorization', 'Bearer ' + adminToken);
    expect(backup.status).toBe(200);

    const mod = await request(app)
      .post('/api/admin/validators')
      .set('Authorization', 'Bearer ' + adminToken)
      .send({ email: 'storage-mod@akab.local', password: 'storage-moderator-123', name: 'Mod' });
    expect(mod.status).toBe(201);
    const modToken = (
      await request(app).post('/api/auth/login').send({ email: 'storage-mod@akab.local', password: 'storage-moderator-123' })
    ).body.token;
    expect((await request(app).get('/api/admin/storage').set('Authorization', 'Bearer ' + modToken)).status).toBe(403);
  });
});

describe('Other storage sources', () => {
  const blob = (n = 64) => crypto.randomBytes(n);
  const idOf = (data: Buffer) => crypto.createHash('sha256').update(data).digest('hex');

  describe('S3-compatible bucket', () => {
    let s3: FakeS3;
    let provider: S3Provider;

    beforeAll(async () => {
      s3 = await startFakeS3('akab-bucket');
      provider = new S3Provider(
        { type: 's3', name: 'cloud', endpoint: s3.endpoint, region: 'eu-west-1', bucket: 'akab-bucket',
          accessKeyId: 'KEY', secretAccessKey: 'SECRET', prefix: 'prod/', pathStyle: true },
        2000
      );
    });
    afterAll(() => s3.close());

    it('stores, reads, lists across pages and deletes blobs under its prefix', async () => {
      const items = [blob(), blob(), blob(), blob(), blob()];
      for (const item of items) await provider.put(idOf(item), item);

      expect([...s3.objects.keys()].every((key) => key.startsWith('prod/blobs/'))).toBe(true);
      expect((await provider.list()).sort()).toEqual(items.map(idOf).sort());
      expect((await provider.get(idOf(items[0])))!.equals(items[0])).toBe(true);
      expect(await provider.get('f'.repeat(64))).toBeNull();

      await provider.delete(idOf(items[0]));
      expect(await provider.get(idOf(items[0]))).toBeNull();
      await expect(provider.get('../etc/passwd')).rejects.toThrow(/invalide/);
    });

    it('keeps pointers apart from blobs and signs every request without leaking the secret', async () => {
      await provider.putPointer('db-latest', Buffer.from('ptr'));
      expect((await provider.getPointer('db-latest'))!.toString()).toBe('ptr');
      expect(await provider.getPointer('missing')).toBeNull();
      expect(s3.objects.has('prod/pointers/db-latest')).toBe(true);
      expect((await provider.list()).every((id) => /^[0-9a-f]{64}$/.test(id))).toBe(true);

      for (const request of s3.requests) {
        expect(request.authorization).toMatch(/Credential=KEY\/\d{8}\/eu-west-1\/s3\/aws4_request/);
        expect(request.authorization).not.toContain('SECRET');
      }
      const status = await provider.status();
      expect(status).toMatchObject({ type: 's3', reachable: true });
      expect(status.blobs).toBeGreaterThan(0);
      expect(JSON.stringify(status)).not.toContain('SECRET');
    });

    it('reports an unreachable bucket', async () => {
      s3.down = true;
      const status = await provider.status();
      s3.down = false;
      expect(status.reachable).toBe(false);
    });
  });

  describe('Directory', () => {
    let dir: string;
    let provider: DirectoryProvider;

    beforeAll(() => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akab-dir-'));
      provider = new DirectoryProvider({ type: 'directory', name: 'usb', path: dir });
    });
    afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

    it('round-trips blobs and pointers and refuses path traversal', async () => {
      const data = blob(300);
      await provider.put(idOf(data), data);
      await provider.put(idOf(data), data);
      expect((await provider.get(idOf(data)))!.equals(data)).toBe(true);
      expect(await provider.list()).toEqual([idOf(data)]);
      expect(fs.readdirSync(path.join(dir, 'blobs', idOf(data).slice(0, 2)))).toEqual([idOf(data)]);

      await provider.putPointer('db-latest', Buffer.from('v1'));
      await provider.putPointer('db-latest', Buffer.from('v2'));
      expect((await provider.getPointer('db-latest'))!.toString()).toBe('v2');

      await expect(provider.get('../../etc/passwd')).rejects.toThrow(/invalide/);
      await expect(provider.getPointer('../x')).rejects.toThrow(/invalide/);
      expect(await provider.status()).toMatchObject({ type: 'directory', reachable: true, blobs: 1, bytes: 300 });

      await provider.delete(idOf(data));
      expect(await provider.get(idOf(data))).toBeNull();
    });
  });

  describe('Mixed fleet (AKAB node + S3 + directory)', () => {
    let node: FakeNode;
    let s3: FakeS3;
    let dir: string;
    const original = { ...config.storage };

    beforeAll(async () => {
      setTestDatabase(new Database(':memory:'));
      node = await startFakeNode('akab-node');
      s3 = await startFakeS3('mixed-bucket');
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'akab-mixed-'));
      config.storage.nodes = [
        { type: 'http', name: 'akab-node', url: node.url, token: node.token },
        { type: 's3', name: 'cloud', endpoint: s3.endpoint, region: 'us-east-1', bucket: 'mixed-bucket',
          accessKeyId: 'KEY', secretAccessKey: 'SECRET', prefix: '', pathStyle: true },
        { type: 'directory', name: 'nas', path: dir },
      ];
      config.storage.encryptionKey = KEY;
      config.storage.replicas = 2;
      config.storage.writeQuorum = 1;
      config.storage.timeoutMs = 2000;
    });

    afterAll(async () => {
      Object.assign(config.storage, original);
      await node.close();
      await s3.close();
      fs.rmSync(dir, { recursive: true, force: true });
      closeDatabase();
    });

    it('replicates encrypted data across different kinds of sources and survives losing one', async () => {
      const data = Buffer.from('preuve '.repeat(100));
      const refs: string[] = [];
      for (let i = 0; i < 6; i += 1) refs.push((await StorageService.store(Buffer.concat([data, blob(8)]), { mimeType: 'image/png' })).ref);

      const where = (id: string) => [
        node.blobs.has(id),
        s3.objects.has(`blobs/${id}`),
        fs.existsSync(path.join(dir, 'blobs', id.slice(0, 2), id)),
      ];
      for (const ref of refs) {
        expect(where(ref.slice(5)).filter(Boolean)).toHaveLength(2);
      }
      const kinds = new Set(refs.flatMap((ref) => where(ref.slice(5)).map((held, i) => (held ? i : -1))));
      expect(kinds.size).toBeGreaterThanOrEqual(3);

      for (const stored of s3.objects.values()) expect(stored.includes(data.subarray(0, 30))).toBe(false);

      node.down = true;
      for (const ref of refs) expect(await StorageService.retrieve(ref)).not.toBeNull();
      node.down = false;

      const missing = refs.find((ref) => s3.objects.has(`blobs/${ref.slice(5)}`))!;
      s3.objects.delete(`blobs/${missing.slice(5)}`);
      const report = await StorageService.repair();
      expect(report.copied).toBeGreaterThanOrEqual(1);
      expect(s3.objects.has(`blobs/${missing.slice(5)}`)).toBe(true);

      const status = await StorageService.status();
      expect(status.nodes.map((n) => [n.name, n.type, n.reachable])).toEqual([
        ['akab-node', 'http', true],
        ['cloud', 's3', true],
        ['nas', 'directory', true],
      ]);
      expect(JSON.stringify(status)).not.toContain('SECRET');
    });

    it('backs up and restores the database using only the mixed sources', async () => {
      getDatabase().exec("CREATE TABLE IF NOT EXISTS mixed_probe (v TEXT); INSERT INTO mixed_probe VALUES ('ok');");
      const report = await StorageService.backupDatabase();
      expect(report.storedOn).toHaveLength(2);

      const target = path.join(dir, 'restored.sqlite');
      await StorageService.restoreLatestBackup(target);
      const copy = new Database(target, { readonly: true });
      expect(copy.prepare('SELECT v FROM mixed_probe').all()).toEqual([{ v: 'ok' }]);
      copy.close();
    });
  });
});
