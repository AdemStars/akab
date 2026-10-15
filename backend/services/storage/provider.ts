export interface NodeStatus {
  name: string;
  type: 'http' | 's3' | 'directory';
  /** Human-readable location; never contains secrets. */
  url: string;
  reachable: boolean;
  latencyMs: number | null;
  blobs?: number;
  bytes?: number;
  quotaBytes?: number;
  error?: string;
}

/** What the replication layer needs from any storage source. */
export interface StorageProvider {
  readonly name: string;
  put(id: string, data: Buffer): Promise<void>;
  get(id: string): Promise<Buffer | null>;
  delete(id: string): Promise<void>;
  list(): Promise<string[]>;
  putPointer(name: string, data: Buffer): Promise<void>;
  getPointer(name: string): Promise<Buffer | null>;
  status(): Promise<NodeStatus>;
}

export const BLOB_ID = /^[0-9a-f]{64}$/;
export const POINTER_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

export function assertBlobId(id: string): void {
  if (!BLOB_ID.test(id)) throw new Error('Identifiant de bloc invalide');
}

export function assertPointerName(name: string): void {
  if (!POINTER_NAME.test(name)) throw new Error('Nom de pointeur invalide');
}
