const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createNodeServer, readConfig } = require('../server');

const TOKEN = 'x'.repeat(40);

async function start(extra = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'akab-node-'));
  const config = { ...readConfig({ NODE_TOKEN: TOKEN, DATA_DIR: dataDir }), ...extra };
  const server = createNodeServer(config);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const call = (method, route, body, token = TOKEN) =>
    fetch(base + route, { method, body, headers: token ? { Authorization: 'Bearer ' + token } : {} });
  return { server, dataDir, call, close: () => new Promise((r) => server.close(r)) };
}

const sha = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('refuses to start without a strong token', () => {
  assert.throws(() => readConfig({ NODE_TOKEN: 'short' }), /NODE_TOKEN/);
});

test('stores, serves, lists and deletes blobs; verifies the hash', async (t) => {
  const node = await start();
  t.after(node.close);
  const data = crypto.randomBytes(2048);
  const id = sha(data);

  assert.strictEqual((await node.call('PUT', `/v1/blobs/${id}`, crypto.randomBytes(10))).status, 400);
  assert.strictEqual((await node.call('PUT', `/v1/blobs/${id}`, data)).status, 201);
  assert.strictEqual((await node.call('PUT', `/v1/blobs/${id}`, data)).status, 200);
  assert.strictEqual((await node.call('HEAD', `/v1/blobs/${id}`)).status, 200);

  const got = Buffer.from(await (await node.call('GET', `/v1/blobs/${id}`)).arrayBuffer());
  assert.ok(got.equals(data));
  assert.deepStrictEqual(await (await node.call('GET', '/v1/blobs')).json(), { ids: [id] });
  assert.deepStrictEqual(await (await node.call('GET', '/v1/status')).json(), { blobs: 1, bytes: 2048, quotaBytes: 0 });

  assert.strictEqual((await node.call('DELETE', `/v1/blobs/${id}`)).status, 200);
  assert.strictEqual((await node.call('GET', `/v1/blobs/${id}`)).status, 404);
  assert.strictEqual(node.server.store.stats().blobs, 0);
});

test('requires the token, except for the health probe', async (t) => {
  const node = await start();
  t.after(node.close);
  assert.strictEqual((await node.call('GET', '/v1/health', undefined, null)).status, 200);
  assert.strictEqual((await node.call('GET', '/v1/status', undefined, null)).status, 401);
  assert.strictEqual((await node.call('GET', '/v1/status', undefined, 'wrong')).status, 401);
});

test('rejects malformed ids and path traversal', async (t) => {
  const node = await start();
  t.after(node.close);
  assert.strictEqual((await node.call('GET', '/v1/blobs/..%2F..%2Fetc%2Fpasswd')).status, 400);
  assert.strictEqual((await node.call('GET', '/v1/pointers/..%2Fsecret')).status, 400);
  assert.strictEqual((await node.call('GET', '/v1/blobs/' + 'G'.repeat(64))).status, 400);
});

test('enforces blob size limit and quota', async (t) => {
  const node = await start({ maxBlobBytes: 1000, quotaBytes: 1500 });
  t.after(node.close);
  const big = crypto.randomBytes(2000);
  assert.strictEqual((await node.call('PUT', `/v1/blobs/${sha(big)}`, big)).status, 413);

  const a = crypto.randomBytes(900);
  const b = crypto.randomBytes(900);
  assert.strictEqual((await node.call('PUT', `/v1/blobs/${sha(a)}`, a)).status, 201);
  assert.strictEqual((await node.call('PUT', `/v1/blobs/${sha(b)}`, b)).status, 413);
  const c = crypto.randomBytes(600);
  assert.strictEqual((await node.call('PUT', `/v1/blobs/${sha(c)}`, c)).status, 201);
  const d = crypto.randomBytes(10);
  assert.strictEqual((await node.call('PUT', `/v1/blobs/${sha(d)}`, d)).status, 507);
});

test('keeps small mutable pointers and rebuilds counters after restart', async (t) => {
  const node = await start();
  assert.strictEqual((await node.call('GET', '/v1/pointers/db-latest')).status, 404);
  assert.strictEqual((await node.call('PUT', '/v1/pointers/db-latest', 'one')).status, 200);
  assert.strictEqual((await node.call('PUT', '/v1/pointers/db-latest', 'two')).status, 200);
  assert.strictEqual(await (await node.call('GET', '/v1/pointers/db-latest')).text(), 'two');
  assert.strictEqual((await node.call('PUT', '/v1/pointers/db-latest', Buffer.alloc(5000))).status, 413);

  const data = crypto.randomBytes(300);
  await node.call('PUT', `/v1/blobs/${sha(data)}`, data);
  await node.close();

  const reopened = createNodeServer({ ...readConfig({ NODE_TOKEN: TOKEN, DATA_DIR: node.dataDir }) });
  assert.deepStrictEqual(reopened.store.stats(), { blobs: 1, bytes: 300 });
  t.after(() => fs.rmSync(node.dataDir, { recursive: true, force: true }));
});
