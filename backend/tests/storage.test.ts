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

describe('Storage configuration', () => {
  const token = 'a'.repeat(32);
  it('validates STORAGE_NODES', () => {
    expect(parseStorageNodes(undefined)).toEqual([]);
    expect(parseStorageNodes(JSON.stringify([{ name: 'paris', url: 'http://h:7000/', token }]))).toEqual([
      { name: 'paris', url: 'http://h:7000', token },
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
