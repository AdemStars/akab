import http from 'http';
import crypto from 'crypto';

/** Minimal in-memory implementation of the AKAB storage-node protocol, with failure injection. */
export interface FakeNode {
  name: string;
  url: string;
  token: string;
  blobs: Map<string, Buffer>;
  pointers: Map<string, Buffer>;
  down: boolean;
  close: () => Promise<void>;
}

export async function startFakeNode(name: string): Promise<FakeNode> {
  const token = crypto.randomBytes(24).toString('hex');
  const node = { name, token, blobs: new Map(), pointers: new Map(), down: false } as FakeNode;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      const reply = (status: number, body?: Buffer | object) => {
        res.writeHead(status, { 'Content-Type': 'application/octet-stream' });
        res.end(Buffer.isBuffer(body) ? body : body ? JSON.stringify(body) : undefined);
      };
      if (node.down) return req.socket.destroy();
      if (req.headers.authorization !== 'Bearer ' + token) return reply(401, { error: 'auth' });

      const parts = (req.url || '').split('/').filter(Boolean);
      const body = Buffer.concat(chunks);
      if (parts[1] === 'status') return reply(200, { blobs: node.blobs.size, bytes: 0, quotaBytes: 0 });
      if (parts[1] === 'blobs' && parts.length === 2) return reply(200, { ids: [...node.blobs.keys()] });
      if (parts[1] === 'blobs') {
        const id = parts[2];
        if (req.method === 'PUT') {
          if (crypto.createHash('sha256').update(body).digest('hex') !== id) return reply(400, { error: 'hash' });
          node.blobs.set(id, body);
          return reply(201, { id });
        }
        if (req.method === 'GET') return node.blobs.has(id) ? reply(200, node.blobs.get(id)) : reply(404, {});
        if (req.method === 'DELETE') return reply(node.blobs.delete(id) ? 200 : 404, {});
      }
      if (parts[1] === 'pointers') {
        if (req.method === 'PUT') {
          node.pointers.set(parts[2], body);
          return reply(200, {});
        }
        return node.pointers.has(parts[2]) ? reply(200, node.pointers.get(parts[2])) : reply(404, {});
      }
      reply(404, {});
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  node.url = `http://127.0.0.1:${(server.address() as any).port}`;
  node.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return node;
}
