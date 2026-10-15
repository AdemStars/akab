import http from 'http';

export interface FakeS3 {
  endpoint: string;
  objects: Map<string, Buffer>;
  requests: Array<{ method: string; path: string; authorization?: string }>;
  down: boolean;
  close: () => Promise<void>;
}

/** Path-style S3 stub: PUT/GET/DELETE object and ListObjectsV2 with pagination. */
export async function startFakeS3(bucket: string, pageSize = 2): Promise<FakeS3> {
  const s3 = { objects: new Map<string, Buffer>(), requests: [], down: false } as unknown as FakeS3;

  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (s3.down) return req.socket.destroy();
      const url = new URL(req.url || '/', 'http://s3');
      s3.requests.push({ method: req.method || '', path: url.pathname, authorization: req.headers.authorization });
      if (!String(req.headers.authorization || '').startsWith('AWS4-HMAC-SHA256 Credential=')) {
        res.writeHead(403);
        return res.end('<Error><Code>AccessDenied</Code></Error>');
      }
      const prefixPath = `/${bucket}`;
      if (!url.pathname.startsWith(prefixPath)) {
        res.writeHead(404);
        return res.end('<Error><Code>NoSuchBucket</Code></Error>');
      }
      const key = decodeURIComponent(url.pathname.slice(prefixPath.length + 1));
      const body = Buffer.concat(chunks);

      if (req.method === 'GET' && url.searchParams.get('list-type') === '2') {
        const prefix = url.searchParams.get('prefix') || '';
        const keys = [...s3.objects.keys()].filter((k) => k.startsWith(prefix)).sort();
        const start = parseInt(url.searchParams.get('continuation-token') || '0', 10);
        const page = keys.slice(start, start + pageSize);
        const more = start + pageSize < keys.length;
        res.writeHead(200, { 'Content-Type': 'application/xml' });
        return res.end(
          `<ListBucketResult><IsTruncated>${more}</IsTruncated>` +
            (more ? `<NextContinuationToken>${start + pageSize}</NextContinuationToken>` : '') +
            page.map((k) => `<Contents><Key>${k}</Key><Size>${s3.objects.get(k)!.length}</Size></Contents>`).join('') +
            '</ListBucketResult>'
        );
      }
      if (req.method === 'PUT') {
        s3.objects.set(key, body);
        res.writeHead(200);
        return res.end();
      }
      if (req.method === 'GET') {
        if (!s3.objects.has(key)) {
          res.writeHead(404);
          return res.end('<Error><Code>NoSuchKey</Code></Error>');
        }
        res.writeHead(200);
        return res.end(s3.objects.get(key));
      }
      if (req.method === 'DELETE') {
        s3.objects.delete(key);
        res.writeHead(204);
        return res.end();
      }
      res.writeHead(405);
      res.end();
    });
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  s3.endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
  s3.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return s3;
}
