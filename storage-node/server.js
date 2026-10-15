'use strict';
/**
 * AKAB storage node — a deliberately dumb, dependency-free blob store.
 *
 * It only ever sees opaque, already-encrypted data. Blobs are addressed by the
 * SHA-256 of their bytes (verified on upload); pointers are tiny mutable values
 * used to find the latest database backup. Authentication is a bearer token.
 */
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const BLOB_ID = /^[0-9a-f]{64}$/;
const POINTER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;
const MAX_POINTER_BYTES = 4096;

function readConfig(env = process.env) {
  const token = (env.NODE_TOKEN || '').trim();
  if (token.length < 32) {
    throw new Error('NODE_TOKEN est obligatoire (au moins 32 caractères).');
  }
  return {
    token,
    port: parseInt(env.PORT || '7000', 10),
    host: env.HOST || '0.0.0.0',
    dataDir: path.resolve(env.DATA_DIR || './data'),
    maxBlobBytes: parseInt(env.MAX_BLOB_BYTES || String(100 * 1024 * 1024), 10),
    quotaBytes: parseInt(env.QUOTA_BYTES || '0', 10),
    tlsCert: env.TLS_CERT,
    tlsKey: env.TLS_KEY,
  };
}

function createStore(dataDir) {
  const blobDir = path.join(dataDir, 'blobs');
  const pointerDir = path.join(dataDir, 'pointers');
  const tmpDir = path.join(dataDir, 'tmp');
  for (const dir of [blobDir, pointerDir, tmpDir]) fs.mkdirSync(dir, { recursive: true });
  for (const name of fs.readdirSync(tmpDir)) fs.rmSync(path.join(tmpDir, name), { force: true });

  const blobPath = (id) => path.join(blobDir, id.slice(0, 2), id);
  let usedBytes = 0;
  let blobCount = 0;

  function* walk() {
    for (const shard of fs.readdirSync(blobDir)) {
      const shardPath = path.join(blobDir, shard);
      if (!fs.statSync(shardPath).isDirectory()) continue;
      for (const id of fs.readdirSync(shardPath)) {
        if (BLOB_ID.test(id)) yield id;
      }
    }
  }
  for (const id of walk()) {
    usedBytes += fs.statSync(blobPath(id)).size;
    blobCount += 1;
  }

  return {
    blobPath,
    tmpDir,
    pointerDir,
    has: (id) => fs.existsSync(blobPath(id)),
    stats: () => ({ blobs: blobCount, bytes: usedBytes }),
    list: () => Array.from(walk()),
    commit(id, tmpFile, size) {
      const target = blobPath(id);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.renameSync(tmpFile, target);
      usedBytes += size;
      blobCount += 1;
    },
    remove(id) {
      const target = blobPath(id);
      if (!fs.existsSync(target)) return false;
      usedBytes -= fs.statSync(target).size;
      blobCount -= 1;
      fs.rmSync(target);
      return true;
    },
  };
}

function tokenMatches(header, expected) {
  const supplied = typeof header === 'string' && header.startsWith('Bearer ') ? header.slice(7) : '';
  const a = crypto.createHash('sha256').update(supplied).digest();
  const b = crypto.createHash('sha256').update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

function send(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...headers });
  res.end(payload);
}

function createNodeServer(config) {
  const store = createStore(config.dataDir);

  function receive(req, res, { limit, onComplete, expectedId }) {
    const declared = parseInt(req.headers['content-length'] || '-1', 10);
    if (declared > limit) return send(res, 413, { error: 'Contenu trop volumineux' });
    const tmpFile = path.join(store.tmpDir, crypto.randomBytes(12).toString('hex'));
    const out = fs.createWriteStream(tmpFile);
    const hash = crypto.createHash('sha256');
    let size = 0;
    let failed = false;

    const fail = (status, message) => {
      if (failed) return;
      failed = true;
      out.destroy();
      fs.rmSync(tmpFile, { force: true });
      if (!res.writableEnded) send(res, status, { error: message }, { Connection: 'close' });
    };

    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        return fail(413, 'Contenu trop volumineux');
      }
      hash.update(chunk);
      if (!out.write(chunk)) {
        req.pause();
        out.once('drain', () => req.resume());
      }
    });
    req.on('aborted', () => fail(400, 'Transfert interrompu'));
    req.on('error', () => fail(400, 'Transfert interrompu'));
    req.on('end', () => {
      if (failed) return;
      out.end(() => {
        const digest = hash.digest('hex');
        if (expectedId && digest !== expectedId) return fail(400, 'Empreinte SHA-256 invalide');
        try {
          onComplete({ tmpFile, size, digest });
        } catch (err) {
          fail(500, 'Erreur de stockage');
        }
      });
    });
  }

  const handler = (req, res) => {
    const url = new URL(req.url, 'http://node');
    const parts = url.pathname.split('/').filter(Boolean);

    if (req.method === 'GET' && url.pathname === '/v1/health') {
      return send(res, 200, { status: 'ok' });
    }
    if (!tokenMatches(req.headers.authorization, config.token)) {
      return send(res, 401, { error: 'Authentification requise' });
    }
    if (parts[0] !== 'v1') return send(res, 404, { error: 'Introuvable' });

    if (parts[1] === 'status' && req.method === 'GET') {
      return send(res, 200, { ...store.stats(), quotaBytes: config.quotaBytes });
    }

    if (parts[1] === 'blobs' && parts.length === 2 && req.method === 'GET') {
      return send(res, 200, { ids: store.list() });
    }

    if (parts[1] === 'blobs' && parts.length === 3) {
      const id = parts[2];
      if (!BLOB_ID.test(id)) return send(res, 400, { error: 'Identifiant invalide' });

      if (req.method === 'HEAD') {
        const target = store.blobPath(id);
        if (!store.has(id)) {
          res.writeHead(404);
          return res.end();
        }
        res.writeHead(200, { 'Content-Length': fs.statSync(target).size });
        return res.end();
      }
      if (req.method === 'GET') {
        if (!store.has(id)) return send(res, 404, { error: 'Bloc introuvable' });
        const target = store.blobPath(id);
        res.writeHead(200, {
          'Content-Type': 'application/octet-stream',
          'Content-Length': fs.statSync(target).size,
          'Cache-Control': 'no-store',
        });
        return fs.createReadStream(target).pipe(res);
      }
      if (req.method === 'DELETE') {
        return store.remove(id) ? send(res, 200, { deleted: true }) : send(res, 404, { error: 'Bloc introuvable' });
      }
      if (req.method === 'PUT') {
        if (store.has(id)) {
          req.resume();
          return send(res, 200, { id, stored: false });
        }
        const room = config.quotaBytes > 0 ? config.quotaBytes - store.stats().bytes : Infinity;
        if (room <= 0) {
          req.resume();
          return send(res, 507, { error: 'Quota de stockage atteint' });
        }
        return receive(req, res, {
          limit: Math.min(config.maxBlobBytes, room),
          expectedId: id,
          onComplete: ({ tmpFile, size }) => {
            if (store.has(id)) {
              fs.rmSync(tmpFile, { force: true });
              return send(res, 200, { id, stored: false });
            }
            store.commit(id, tmpFile, size);
            send(res, 201, { id, stored: true });
          },
        });
      }
    }

    if (parts[1] === 'pointers' && parts.length === 3) {
      const name = parts[2];
      if (!POINTER_NAME.test(name)) return send(res, 400, { error: 'Nom invalide' });
      const target = path.join(store.pointerDir, name);
      if (req.method === 'GET') {
        if (!fs.existsSync(target)) return send(res, 404, { error: 'Pointeur introuvable' });
        res.writeHead(200, { 'Content-Type': 'application/octet-stream', 'Cache-Control': 'no-store' });
        return res.end(fs.readFileSync(target));
      }
      if (req.method === 'PUT') {
        return receive(req, res, {
          limit: MAX_POINTER_BYTES,
          onComplete: ({ tmpFile }) => {
            fs.renameSync(tmpFile, target);
            send(res, 200, { name, stored: true });
          },
        });
      }
    }

    return send(res, 404, { error: 'Introuvable' });
  };

  const server =
    config.tlsCert && config.tlsKey
      ? https.createServer({ cert: fs.readFileSync(config.tlsCert), key: fs.readFileSync(config.tlsKey) }, handler)
      : http.createServer(handler);
  server.requestTimeout = 5 * 60 * 1000;
  server.store = store;
  return server;
}

module.exports = { createNodeServer, readConfig };

if (require.main === module) {
  const config = readConfig();
  const server = createNodeServer(config);
  server.listen(config.port, config.host, () => {
    const scheme = config.tlsCert ? 'https' : 'http';
    console.log(`[AKAB node] ${scheme}://${config.host}:${config.port} — données : ${config.dataDir}`);
    if (!config.tlsCert) {
      console.warn('[AKAB node] Pas de TLS : placez le nœud derrière HTTPS (proxy inverse, tunnel) hors réseau privé.');
    }
  });
  const stop = () => server.close(() => process.exit(0));
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
}
