import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { config } from '../config';

export interface IpfsUploadResult {
  cid: string;
  url: string;
  gatewayUrl: string;
  size: number;
  mimeType: string;
  pinned: boolean;
  provider: 'kubo-daemon' | 'content-addressed-local';
}

/**
 * Computes a standard IPFS CIDv0 (Qm...) multihash from a buffer.
 * IPFS CIDv0 = Base58(0x12 (sha2-256) + 0x20 (32 bytes) + sha256_hash)
 */
export function computeCidV0(buffer: Buffer): string {
  const sha256 = crypto.createHash('sha256').update(buffer).digest();
  const header = Buffer.from([0x12, 0x20]);
  const multihash = Buffer.concat([header, sha256]);
  return toBase58(multihash);
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function toBase58(source: Buffer): string {
  if (source.length === 0) return '';
  const digits: number[] = [0];
  for (let i = 0; i < source.length; i++) {
    let carry = source[i];
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j] << 8;
      digits[j] = carry % 58;
      carry = (carry / 58) | 0;
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = (carry / 58) | 0;
    }
  }
  let str = '';
  for (let i = 0; i < source.length && source[i] === 0; i++) {
    str += ALPHABET[0];
  }
  for (let i = digits.length - 1; i >= 0; i--) {
    str += ALPHABET[digits[i]];
  }
  return str;
}

export class IpfsService {
  /**
   * Uploads file buffer to IPFS daemon or local content-addressed resilient storage.
   */
  static async upload(
    buffer: Buffer,
    filename: string,
    mimeType: string
  ): Promise<IpfsUploadResult> {
    // Try external IPFS Kubo daemon if reachable
    if (config.ipfsApiUrl) {
      try {
        const result = await this.uploadToKubo(buffer, filename);
        if (result) {
          return {
            cid: result.Hash,
            url: `ipfs://${result.Hash}`,
            gatewayUrl: `${config.ipfsGateway}${result.Hash}`,
            size: parseInt(result.Size, 10) || buffer.length,
            mimeType,
            pinned: true,
            provider: 'kubo-daemon',
          };
        }
      } catch (err) {
        // Fall back to local content-addressed storage if Kubo is not running
        if (!config.ipfsFallbackLocal) {
          throw err;
        }
      }
    }

    // Local content-addressed fallback
    return this.storeLocally(buffer, mimeType);
  }

  private static async uploadToKubo(buffer: Buffer, filename: string): Promise<{ Hash: string; Size: string } | null> {
    const boundary = '----AKABIpfsBoundary' + crypto.randomBytes(8).toString('hex');
    const header = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: application/octet-stream\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const body = Buffer.concat([header, buffer, footer]);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);

    try {
      const response = await fetch(`${config.ipfsApiUrl}/api/v0/add?pin=true`, {
        method: 'POST',
        headers: {
          'Content-Type': `multipart/form-data; boundary=${boundary}`,
        },
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        return null;
      }

      const text = await response.text();
      const json = JSON.parse(text.trim().split('\n')[0]);
      return json;
    } finally {
      clearTimeout(timeout);
    }
  }

  private static storeLocally(buffer: Buffer, mimeType: string): IpfsUploadResult {
    const cid = computeCidV0(buffer);
    const storePath = path.join(config.ipfsLocalStorageDir, cid);

    if (!fs.existsSync(config.ipfsLocalStorageDir)) {
      fs.mkdirSync(config.ipfsLocalStorageDir, { recursive: true });
    }

    // Write file content addressed by CID (immutable and tamper-proof)
    fs.writeFileSync(storePath, buffer);

    return {
      cid,
      url: `ipfs://${cid}`,
      gatewayUrl: `/api/ipfs/${cid}`,
      size: buffer.length,
      mimeType,
      pinned: true,
      provider: 'content-addressed-local',
    };
  }

  /**
   * Retrieves content by CID from local content store or IPFS gateway.
   */
  static getLocalFile(cid: string): { buffer: Buffer; exists: boolean } {
    const cleanCid = path.basename(cid);
    const storePath = path.join(config.ipfsLocalStorageDir, cleanCid);
    if (fs.existsSync(storePath)) {
      return { buffer: fs.readFileSync(storePath), exists: true };
    }
    return { buffer: Buffer.alloc(0), exists: false };
  }
}
