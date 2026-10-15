import { S3NodeConfig } from '../../config';
import { NodeStatus, StorageProvider, assertBlobId, assertPointerName } from './provider';
import { amzDateNow, sha256Hex, signRequest } from './sigv4';

const MAX_LIST_PAGES = 100;

/** Provider for any S3-compatible bucket (AWS, Backblaze B2, MinIO, Wasabi, R2…). No SDK needed. */
export class S3Provider implements StorageProvider {
  constructor(private readonly node: S3NodeConfig, private readonly timeoutMs: number) {}

  get name(): string {
    return this.node.name;
  }

  private objectUrl(key: string, query: Record<string, string> = {}): URL {
    const endpoint = new URL(this.node.endpoint);
    const encodedKey = key ? key.split('/').map(encodeURIComponent).join('/') : '';
    let url: URL;
    if (this.node.pathStyle) {
      url = new URL(`${endpoint.origin}${endpoint.pathname.replace(/\/$/, '')}/${this.node.bucket}${encodedKey ? '/' + encodedKey : ''}`);
    } else {
      url = new URL(`${endpoint.protocol}//${this.node.bucket}.${endpoint.host}${endpoint.pathname.replace(/\/$/, '')}/${encodedKey}`);
    }
    for (const [name, value] of Object.entries(query)) url.searchParams.set(name, value);
    return url;
  }

  private async request(method: string, url: URL, body?: Buffer): Promise<Response> {
    const payloadHash = sha256Hex(body ?? '');
    const amzDate = amzDateNow();
    const headers: Record<string, string> = { 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate };
    const authorization = signRequest({
      method,
      url,
      headers,
      payloadHash,
      accessKeyId: this.node.accessKeyId,
      secretAccessKey: this.node.secretAccessKey,
      region: this.node.region,
      amzDate,
    });
    return fetch(url, {
      method,
      headers: { ...headers, Authorization: authorization },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  private blobKey(id: string): string {
    assertBlobId(id);
    return `${this.node.prefix}blobs/${id}`;
  }

  async put(id: string, data: Buffer): Promise<void> {
    const res = await this.request('PUT', this.objectUrl(this.blobKey(id)), data);
    if (!res.ok) throw new Error(`${this.node.name}: écriture refusée (${res.status})`);
  }

  async get(id: string): Promise<Buffer | null> {
    const res = await this.request('GET', this.objectUrl(this.blobKey(id)));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${this.node.name}: lecture refusée (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(id: string): Promise<void> {
    const res = await this.request('DELETE', this.objectUrl(this.blobKey(id)));
    if (!res.ok && res.status !== 404) throw new Error(`${this.node.name}: suppression refusée (${res.status})`);
  }

  private async listObjects(): Promise<Array<{ key: string; size: number }>> {
    const objects: Array<{ key: string; size: number }> = [];
    let token: string | undefined;
    for (let page = 0; page < MAX_LIST_PAGES; page += 1) {
      const query: Record<string, string> = { 'list-type': '2', prefix: `${this.node.prefix}blobs/` };
      if (token) query['continuation-token'] = token;
      const res = await this.request('GET', this.objectUrl('', query));
      if (!res.ok) throw new Error(`${this.node.name}: liste refusée (${res.status})`);
      const xml = await res.text();
      for (const match of xml.matchAll(/<Contents>([\s\S]*?)<\/Contents>/g)) {
        const key = /<Key>([^<]*)<\/Key>/.exec(match[1])?.[1];
        const size = parseInt(/<Size>(\d+)<\/Size>/.exec(match[1])?.[1] ?? '0', 10);
        if (key) objects.push({ key, size });
      }
      if (!/<IsTruncated>true<\/IsTruncated>/.test(xml)) return objects;
      token = /<NextContinuationToken>([^<]*)<\/NextContinuationToken>/.exec(xml)?.[1];
      if (!token) return objects;
    }
    return objects;
  }

  async list(): Promise<string[]> {
    const base = `${this.node.prefix}blobs/`;
    return (await this.listObjects())
      .map((object) => object.key.slice(base.length))
      .filter((id) => /^[0-9a-f]{64}$/.test(id));
  }

  async putPointer(name: string, data: Buffer): Promise<void> {
    assertPointerName(name);
    const res = await this.request('PUT', this.objectUrl(`${this.node.prefix}pointers/${name}`), data);
    if (!res.ok) throw new Error(`${this.node.name}: pointeur refusé (${res.status})`);
  }

  async getPointer(name: string): Promise<Buffer | null> {
    assertPointerName(name);
    const res = await this.request('GET', this.objectUrl(`${this.node.prefix}pointers/${name}`));
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${this.node.name}: pointeur illisible (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async status(): Promise<NodeStatus> {
    const started = Date.now();
    const base = {
      name: this.node.name,
      type: 's3' as const,
      url: `s3://${this.node.bucket}/${this.node.prefix} @ ${new URL(this.node.endpoint).host}`,
    };
    try {
      const objects = await this.listObjects();
      return {
        ...base,
        reachable: true,
        latencyMs: Date.now() - started,
        blobs: objects.length,
        bytes: objects.reduce((total, object) => total + object.size, 0),
        quotaBytes: 0,
      };
    } catch (err: any) {
      return { ...base, reachable: false, latencyMs: null, error: err?.message || 'injoignable' };
    }
  }
}
