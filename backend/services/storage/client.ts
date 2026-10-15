import { HttpNodeConfig } from '../../config';
import { NodeStatus, StorageProvider } from './provider';

/** Provider for an AKAB storage node (storage-node/) reached over HTTP(S). */
export class StorageNodeClient implements StorageProvider {
  constructor(private readonly node: HttpNodeConfig, private readonly timeoutMs: number) {}

  get name(): string {
    return this.node.name;
  }

  private async request(method: string, route: string, body?: Buffer): Promise<Response> {
    return fetch(this.node.url + route, {
      method,
      headers: { Authorization: 'Bearer ' + this.node.token },
      body: body ? new Uint8Array(body) : undefined,
      signal: AbortSignal.timeout(this.timeoutMs),
    });
  }

  async put(id: string, data: Buffer): Promise<void> {
    const res = await this.request('PUT', `/v1/blobs/${id}`, data);
    if (!res.ok) throw new Error(`${this.node.name}: écriture refusée (${res.status})`);
  }

  async get(id: string): Promise<Buffer | null> {
    const res = await this.request('GET', `/v1/blobs/${id}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${this.node.name}: lecture refusée (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(id: string): Promise<void> {
    const res = await this.request('DELETE', `/v1/blobs/${id}`);
    if (!res.ok && res.status !== 404) throw new Error(`${this.node.name}: suppression refusée (${res.status})`);
  }

  async list(): Promise<string[]> {
    const res = await this.request('GET', '/v1/blobs');
    if (!res.ok) throw new Error(`${this.node.name}: liste refusée (${res.status})`);
    return ((await res.json()) as { ids: string[] }).ids;
  }

  async putPointer(name: string, data: Buffer): Promise<void> {
    const res = await this.request('PUT', `/v1/pointers/${name}`, data);
    if (!res.ok) throw new Error(`${this.node.name}: pointeur refusé (${res.status})`);
  }

  async getPointer(name: string): Promise<Buffer | null> {
    const res = await this.request('GET', `/v1/pointers/${name}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`${this.node.name}: pointeur illisible (${res.status})`);
    return Buffer.from(await res.arrayBuffer());
  }

  async status(): Promise<NodeStatus> {
    const started = Date.now();
    const base = { name: this.node.name, type: 'http' as const, url: this.node.url };
    try {
      const res = await this.request('GET', '/v1/status');
      if (!res.ok) throw new Error(res.status === 401 ? 'jeton refusé' : `HTTP ${res.status}`);
      const body = (await res.json()) as { blobs: number; bytes: number; quotaBytes: number };
      return { ...base, reachable: true, latencyMs: Date.now() - started, ...body };
    } catch (err: any) {
      return { ...base, reachable: false, latencyMs: null, error: err?.message || 'injoignable' };
    }
  }
}
