import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { DirectoryNodeConfig } from '../../config';
import { NodeStatus, StorageProvider, assertBlobId, assertPointerName, BLOB_ID } from './provider';

/** Provider for a plain directory: local disk, NAS share, USB drive, sshfs/rclone mount… */
export class DirectoryProvider implements StorageProvider {
  private readonly blobDir: string;
  private readonly pointerDir: string;

  constructor(private readonly node: DirectoryNodeConfig) {
    this.blobDir = path.join(node.path, 'blobs');
    this.pointerDir = path.join(node.path, 'pointers');
  }

  get name(): string {
    return this.node.name;
  }

  private blobPath(id: string): string {
    assertBlobId(id);
    return path.join(this.blobDir, id.slice(0, 2), id);
  }

  private async writeAtomically(target: string, data: Buffer): Promise<void> {
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.${crypto.randomBytes(6).toString('hex')}.tmp`;
    try {
      await fs.promises.writeFile(tmp, data, { mode: 0o600 });
      await fs.promises.rename(tmp, target);
    } catch (err) {
      await fs.promises.rm(tmp, { force: true });
      throw err;
    }
  }

  private async read(target: string): Promise<Buffer | null> {
    try {
      return await fs.promises.readFile(target);
    } catch (err: any) {
      if (err?.code === 'ENOENT') return null;
      throw err;
    }
  }

  async put(id: string, data: Buffer): Promise<void> {
    const target = this.blobPath(id);
    if (fs.existsSync(target)) return;
    await this.writeAtomically(target, data);
  }

  async get(id: string): Promise<Buffer | null> {
    return this.read(this.blobPath(id));
  }

  async delete(id: string): Promise<void> {
    await fs.promises.rm(this.blobPath(id), { force: true });
  }

  private async walk(): Promise<Array<{ id: string; size: number }>> {
    const found: Array<{ id: string; size: number }> = [];
    let shards: string[];
    try {
      shards = await fs.promises.readdir(this.blobDir);
    } catch {
      return found;
    }
    for (const shard of shards) {
      const shardPath = path.join(this.blobDir, shard);
      if (!(await fs.promises.stat(shardPath)).isDirectory()) continue;
      for (const id of await fs.promises.readdir(shardPath)) {
        if (BLOB_ID.test(id)) found.push({ id, size: (await fs.promises.stat(path.join(shardPath, id))).size });
      }
    }
    return found;
  }

  async list(): Promise<string[]> {
    return (await this.walk()).map((entry) => entry.id);
  }

  putPointer(name: string, data: Buffer): Promise<void> {
    assertPointerName(name);
    return this.writeAtomically(path.join(this.pointerDir, name), data);
  }

  async getPointer(name: string): Promise<Buffer | null> {
    assertPointerName(name);
    return this.read(path.join(this.pointerDir, name));
  }

  async status(): Promise<NodeStatus> {
    const started = Date.now();
    const base = { name: this.node.name, type: 'directory' as const, url: `dossier ${this.node.path}` };
    try {
      await fs.promises.mkdir(this.node.path, { recursive: true });
      await fs.promises.access(this.node.path, fs.constants.R_OK | fs.constants.W_OK);
      const entries = await this.walk();
      return {
        ...base,
        reachable: true,
        latencyMs: Date.now() - started,
        blobs: entries.length,
        bytes: entries.reduce((total, entry) => total + entry.size, 0),
        quotaBytes: 0,
      };
    } catch (err: any) {
      return { ...base, reachable: false, latencyMs: null, error: err?.code === 'EACCES' ? 'accès refusé' : err?.message };
    }
  }
}
