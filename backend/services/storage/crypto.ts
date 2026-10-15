import crypto from 'crypto';

const MAGIC = Buffer.from('AKB1');
const SALT_BYTES = 16;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const HEADER_BYTES = MAGIC.length + SALT_BYTES + IV_BYTES + TAG_BYTES;

export interface BlobMeta {
  mimeType?: string;
  [key: string]: unknown;
}

function deriveKey(masterKey: Buffer, salt: Buffer): Buffer {
  return Buffer.from(crypto.hkdfSync('sha256', masterKey, salt, 'akab-blob-v1', 32));
}

/**
 * Seals data + metadata into one opaque blob: AKB1 | salt | iv | tag | ciphertext.
 * Each blob gets its own key derived from the master key, so nodes learn nothing
 * about content, type or filenames.
 */
export function sealBlob(masterKey: Buffer, data: Buffer, meta: BlobMeta = {}): Buffer {
  const metaBytes = Buffer.from(JSON.stringify(meta));
  const length = Buffer.alloc(4);
  length.writeUInt32BE(metaBytes.length);
  const plaintext = Buffer.concat([length, metaBytes, data]);

  const salt = crypto.randomBytes(SALT_BYTES);
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv('aes-256-gcm', deriveKey(masterKey, salt), iv);
  cipher.setAAD(MAGIC);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return Buffer.concat([MAGIC, salt, iv, cipher.getAuthTag(), ciphertext]);
}

export function openBlob(masterKey: Buffer, blob: Buffer): { data: Buffer; meta: BlobMeta } {
  if (blob.length < HEADER_BYTES + 4 || !blob.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('Format de bloc inconnu');
  }
  let offset = MAGIC.length;
  const salt = blob.subarray(offset, (offset += SALT_BYTES));
  const iv = blob.subarray(offset, (offset += IV_BYTES));
  const tag = blob.subarray(offset, (offset += TAG_BYTES));

  const decipher = crypto.createDecipheriv('aes-256-gcm', deriveKey(masterKey, salt), iv);
  decipher.setAAD(MAGIC);
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(blob.subarray(offset)), decipher.final()]);
  } catch {
    throw new Error('Déchiffrement impossible : clé incorrecte ou bloc altéré');
  }

  const metaLength = plaintext.readUInt32BE(0);
  const meta = JSON.parse(plaintext.subarray(4, 4 + metaLength).toString('utf8'));
  return { meta, data: plaintext.subarray(4 + metaLength) };
}

export function sha256Hex(buffer: Buffer): string {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

/** Rendezvous (highest-random-weight) ordering: stable placement that survives adding/removing nodes. */
export function rankNodes<T extends { name: string }>(nodes: T[], key: string): T[] {
  return [...nodes]
    .map((node) => ({ node, score: crypto.createHash('sha256').update(`${node.name}:${key}`).digest('hex') }))
    .sort((a, b) => (a.score < b.score ? 1 : a.score > b.score ? -1 : 0))
    .map((entry) => entry.node);
}
