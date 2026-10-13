import path from 'path';

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class AnonymizationService {
  /**
   * Strips EXIF metadata (specifically APP1/APP2 markers containing GPS, camera serials, timestamps)
   * from JPEG files to prevent accidental leakage of reporter identity or device data.
   */
  static stripExif(buffer: Buffer, mimeType: string): Buffer {
    if (mimeType !== 'image/jpeg' && mimeType !== 'image/jpg') {
      return buffer;
    }

    try {
      if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
        return buffer; // Not a valid JPEG
      }

      let offset = 2;
      const chunks: Buffer[] = [buffer.subarray(0, 2)];

      while (offset < buffer.length) {
        if (buffer[offset] !== 0xff) {
          chunks.push(buffer.subarray(offset));
          break;
        }

        const marker = buffer[offset + 1];

        // Standalone markers: RST0-RST7, SOI, EOI, TEM
        if (
          marker === 0xd9 || // EOI
          marker === 0xda || // SOS (Start of Scan - image data follows)
          (marker >= 0xd0 && marker <= 0xd7)
        ) {
          chunks.push(buffer.subarray(offset));
          break;
        }

        const length = buffer.readUInt16BE(offset + 2);
        const segmentEnd = offset + 2 + length;

        // Strip APP1 (0xE1: EXIF / XMP), APP2 (0xE2: FlashPix / ICC), APP13 (0xED: Photoshop)
        const isMetadataMarker = marker === 0xe1 || marker === 0xe2 || marker === 0xed;

        if (!isMetadataMarker) {
          chunks.push(buffer.subarray(offset, segmentEnd));
        }

        offset = segmentEnd;
      }

      return Buffer.concat(chunks);
    } catch {
      // If parsing fails, return original buffer
      return buffer;
    }
  }

  /**
   * Sanitizes uploaded filenames to prevent path traversal or leaking original username
   */
  static sanitizeFilename(originalName: string, prefix = 'akab_proof'): string {
    const ext = path.extname(originalName).toLowerCase();
    const safeExt = ['.jpg', '.jpeg', '.png', '.mp4', '.mov', '.webm'].includes(ext)
      ? ext
      : '.jpg';
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 8)}${safeExt}`;
  }

  /**
   * Validates whether an evidence item has been anonymized
   */
  static isMarkedAnonymized(metadata: { anonymized?: boolean }): boolean {
    return Boolean(metadata.anonymized);
  }
}
