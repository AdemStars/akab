import fs from 'fs';
import os from 'os';
import path from 'path';
import { config, getDatabase } from '../../config';
import { StorageNodeClient } from './client';
import { DirectoryProvider } from './directory';
import { NodeStatus, StorageProvider } from './provider';
import { S3Provider } from './s3';
import { BlobMeta, openBlob, rankNodes, sealBlob, sha256Hex } from './crypto';

export const BLOB_REF_PREFIX = 'akab-';
const BLOB_REF = /^akab-([0-9a-f]{64})$/;
const DB_POINTER = 'db-latest';

export class StorageUnavailableError extends Error {}

export interface RepairReport {
  scanned: number;
  copied: number;
  failed: number;
  unreachableNodes: string[];
}

export interface BackupReport {
  blobId: string;
  size: number;
  storedOn: string[];
  createdAt: string;
}

export function parseBlobRef(ref: string): string | null {
  return BLOB_REF.exec(ref)?.[1] ?? null;
}

function clients(): StorageProvider[] {
  return config.storage.nodes.map((node): StorageProvider => {
    switch (node.type) {
      case 's3':
        return new S3Provider(node, config.storage.timeoutMs);
      case 'directory':
        return new DirectoryProvider(node);
      default:
        return new StorageNodeClient(node, config.storage.timeoutMs);
    }
  });
}

function key(): Buffer {
  if (!config.storage.encryptionKey) throw new StorageUnavailableError('Clé de chiffrement du stockage absente');
  return config.storage.encryptionKey;
}

export class StorageService {
  static isEnabled(): boolean {
    return config.storage.nodes.length > 0 && !!config.storage.encryptionKey;
  }

  /** Where a blob should live: top-N nodes by rendezvous hash of its id. */
  private static placement(id: string, all: StorageProvider[]): StorageProvider[] {
    return rankNodes(all, id).slice(0, Math.min(config.storage.replicas, all.length));
  }

  private static quorum(targets: number): number {
    return Math.min(config.storage.writeQuorum, targets);
  }

  /** Encrypts and replicates data; returns a reference usable as evidence `cid`. */
  static async store(data: Buffer, meta: BlobMeta): Promise<{ ref: string; size: number; storedOn: string[] }> {
    const sealed = sealBlob(key(), data, meta);
    const id = sha256Hex(sealed);
    const { storedOn } = await this.replicate(id, sealed);
    return { ref: BLOB_REF_PREFIX + id, size: sealed.length, storedOn };
  }

  private static async replicate(id: string, sealed: Buffer): Promise<{ storedOn: string[] }> {
    const all = clients();
    const targets = this.placement(id, all);
    const results = await Promise.allSettled(targets.map((node) => node.put(id, sealed)));
    const storedOn = targets.filter((_, i) => results[i].status === 'fulfilled').map((node) => node.name);

    if (storedOn.length < this.quorum(targets.length)) {
      throw new StorageUnavailableError(
        `Stockage indisponible : ${storedOn.length}/${targets.length} nœud(s) ont accepté l'écriture`
      );
    }
    return { storedOn };
  }

  private static async fetchSealed(id: string): Promise<Buffer | null> {
    const all = clients();
    const preferred = this.placement(id, all);
    const order = [...preferred, ...all.filter((node) => !preferred.includes(node))];
    for (const node of order) {
      try {
        const blob = await node.get(id);
        if (blob && sha256Hex(blob) === id) return blob;
      } catch {
        // try the next replica
      }
    }
    return null;
  }

  static async retrieve(ref: string): Promise<{ data: Buffer; meta: BlobMeta } | null> {
    const id = parseBlobRef(ref);
    if (!id) return null;
    const sealed = await this.fetchSealed(id);
    return sealed ? openBlob(key(), sealed) : null;
  }

  static async remove(ref: string): Promise<void> {
    const id = parseBlobRef(ref);
    if (!id) return;
    await Promise.allSettled(clients().map((node) => node.delete(id)));
  }

  static async status(): Promise<{ enabled: boolean; replicas: number; writeQuorum: number; nodes: NodeStatus[] }> {
    return {
      enabled: this.isEnabled(),
      replicas: config.storage.replicas,
      writeQuorum: config.storage.writeQuorum,
      nodes: await Promise.all(clients().map((node) => node.status())),
    };
  }

  /** Copies blobs onto the nodes they should live on, from any node still holding them. */
  static async repair(): Promise<RepairReport> {
    const all = clients();
    const holders = new Map<string, Set<StorageProvider>>();
    const unreachable: string[] = [];

    await Promise.all(
      all.map(async (node) => {
        try {
          for (const id of await node.list()) {
            if (!holders.has(id)) holders.set(id, new Set());
            holders.get(id)!.add(node);
          }
        } catch {
          unreachable.push(node.name);
        }
      })
    );

    const reachable = all.filter((node) => !unreachable.includes(node.name));
    let copied = 0;
    let failed = 0;
    for (const [id, have] of holders) {
      const missing = this.placement(id, all).filter((node) => reachable.includes(node) && !have.has(node));
      if (missing.length === 0) continue;

      let sealed: Buffer | null = null;
      for (const source of have) {
        try {
          const blob = await source.get(id);
          if (blob && sha256Hex(blob) === id) {
            sealed = blob;
            break;
          }
        } catch {
          // try another holder
        }
      }
      if (!sealed) {
        failed += missing.length;
        continue;
      }
      for (const node of missing) {
        try {
          await node.put(id, sealed);
          copied += 1;
        } catch {
          failed += 1;
        }
      }
    }
    return { scanned: holders.size, copied, failed, unreachableNodes: unreachable.sort() };
  }

  /** Encrypted snapshot of the SQLite database, found again through an encrypted pointer. */
  static async backupDatabase(): Promise<BackupReport> {
    const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'akab-backup-')), 'snapshot.sqlite');
    try {
      await getDatabase().backup(tmp);
      const createdAt = new Date().toISOString();
      const { ref, size, storedOn } = await this.store(fs.readFileSync(tmp), { kind: 'database', createdAt });
      const blobId = parseBlobRef(ref)!;

      const pointer = sealBlob(key(), Buffer.from(JSON.stringify({ blobId, createdAt })), { kind: 'pointer' });
      const results = await Promise.allSettled(clients().map((node) => node.putPointer(DB_POINTER, pointer)));
      if (!results.some((result) => result.status === 'fulfilled')) {
        throw new StorageUnavailableError('Aucun nœud n\'a accepté le pointeur de sauvegarde');
      }
      return { blobId, size, storedOn, createdAt };
    } finally {
      fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
    }
  }

  /** Reads the newest backup pointer across nodes and writes the decrypted database to `destination`. */
  static async restoreLatestBackup(destination: string): Promise<{ createdAt: string; blobId: string }> {
    let latest: { blobId: string; createdAt: string } | null = null;
    for (const node of clients()) {
      try {
        const raw = await node.getPointer(DB_POINTER);
        if (!raw) continue;
        const candidate = JSON.parse(openBlob(key(), raw).data.toString('utf8'));
        if (!latest || candidate.createdAt > latest.createdAt) latest = candidate;
      } catch {
        // unreachable node or unreadable pointer: ignore
      }
    }
    if (!latest) throw new StorageUnavailableError('Aucune sauvegarde trouvée sur les nœuds');

    const restored = await this.retrieve(BLOB_REF_PREFIX + latest.blobId);
    if (!restored) throw new StorageUnavailableError('Bloc de sauvegarde introuvable sur les nœuds');
    fs.writeFileSync(destination, restored.data, { mode: 0o600 });
    return latest;
  }
}
