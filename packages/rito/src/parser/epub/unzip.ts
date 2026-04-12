// ZIP decompressor for EPUB archives.
//
// Parses ZIP structure (EOCD, central directory, local headers, ZIP64) ourselves
// and delegates raw DEFLATE decompression to fflate's inflateSync. This handles
// edge cases that trip up fflate's built-in unzipSync: unusual extra fields,
// ZIP64 entries, prepended data, etc.

import { inflateSync } from 'fflate';
import { EpubParseError } from './errors';

function readU16(d: Uint8Array, o: number): number {
  return (d[o] ?? 0) | ((d[o + 1] ?? 0) << 8);
}

function readU32(d: Uint8Array, o: number): number {
  return (
    ((d[o] ?? 0) | ((d[o + 1] ?? 0) << 8) | ((d[o + 2] ?? 0) << 16) | ((d[o + 3] ?? 0) << 24)) >>> 0
  );
}

function readU64(d: Uint8Array, o: number): number {
  // Read as two 32-bit halves. For files < 2^53 bytes this is exact.
  return readU32(d, o + 4) * 0x1_0000_0000 + readU32(d, o);
}

/** Locate the End of Central Directory record by scanning backwards. */
function findEOCD(
  d: Uint8Array,
): { cdCount: number; cdOffset: number; eocdOffset: number } | undefined {
  const minPos = Math.max(0, d.length - 22 - 65535);
  for (let i = d.length - 22; i >= minPos; i--) {
    if (readU32(d, i) === 0x06054b50) {
      return { cdCount: readU16(d, i + 10), cdOffset: readU32(d, i + 16), eocdOffset: i };
    }
  }
  return undefined;
}

/** If the EOCD signals ZIP64, locate the ZIP64 EOCD and read the real values. */
function findZip64EOCD(
  d: Uint8Array,
  eocdOffset: number,
): { cdCount: number; cdOffset: number } | undefined {
  const locatorPos = eocdOffset - 20;
  if (locatorPos < 0 || readU32(d, locatorPos) !== 0x07064b50) return undefined;

  const zip64Offset = readU64(d, locatorPos + 8);
  if (zip64Offset + 56 > d.length) return undefined;
  if (readU32(d, zip64Offset) !== 0x06064b50) return undefined;

  return { cdCount: readU64(d, zip64Offset + 32), cdOffset: readU64(d, zip64Offset + 48) };
}

/** Parse ZIP64 extra field to resolve 0xFFFFFFFF sentinel values. */
function parseZip64Extra(
  extra: Uint8Array,
  uncompressed: number,
  compressed: number,
  localOffset: number,
): { uncompressed: number; compressed: number; localOffset: number } {
  let pos = 0;
  while (pos + 4 <= extra.length) {
    const id = readU16(extra, pos);
    const size = readU16(extra, pos + 2);
    if (id === 0x0001) {
      let fp = pos + 4;
      const end = pos + 4 + size;
      let u = uncompressed;
      let c = compressed;
      let l = localOffset;
      if (uncompressed === 0xffffffff && fp + 8 <= end) {
        u = readU64(extra, fp);
        fp += 8;
      }
      if (compressed === 0xffffffff && fp + 8 <= end) {
        c = readU64(extra, fp);
        fp += 8;
      }
      if (localOffset === 0xffffffff && fp + 8 <= end) {
        l = readU64(extra, fp);
      }
      return { uncompressed: u, compressed: c, localOffset: l };
    }
    pos += 4 + size;
  }
  return { uncompressed, compressed, localOffset };
}

interface CdEntry {
  compression: number;
  compressedSize: number;
  uncompressedSize: number;
  localHeaderOffset: number;
  filename: string;
}

/** Parse one central directory entry at `pos`. */
function parseCdEntry(
  data: Uint8Array,
  pos: number,
  decoder: TextDecoder,
): { entry: CdEntry; next: number } | undefined {
  if (pos + 46 > data.length || readU32(data, pos) !== 0x02014b50) return undefined;

  const fnLen = readU16(data, pos + 28);
  const exLen = readU16(data, pos + 30);
  const cmLen = readU16(data, pos + 32);

  let cs = readU32(data, pos + 20);
  let us = readU32(data, pos + 24);
  let lo = readU32(data, pos + 42);

  if (cs === 0xffffffff || us === 0xffffffff || lo === 0xffffffff) {
    const ex = data.subarray(pos + 46 + fnLen, pos + 46 + fnLen + exLen);
    const z = parseZip64Extra(ex, us, cs, lo);
    cs = z.compressed;
    us = z.uncompressed;
    lo = z.localOffset;
  }

  return {
    entry: {
      compression: readU16(data, pos + 10),
      compressedSize: cs,
      uncompressedSize: us,
      localHeaderOffset: lo,
      filename: decoder.decode(data.subarray(pos + 46, pos + 46 + fnLen)),
    },
    next: pos + 46 + fnLen + exLen + cmLen,
  };
}

/** Extract file data for a single entry from its local file header. */
function extractEntry(data: Uint8Array, entry: CdEntry): Uint8Array | undefined {
  const lh = entry.localHeaderOffset;
  if (lh + 30 > data.length || readU32(data, lh) !== 0x04034b50) return undefined;

  const dataStart = lh + 30 + readU16(data, lh + 26) + readU16(data, lh + 28);
  const compSz = entry.compressedSize || readU32(data, lh + 18);
  const uncompSz = entry.uncompressedSize || readU32(data, lh + 22);
  if (dataStart + compSz > data.length) return undefined;

  const raw = data.subarray(dataStart, dataStart + compSz);
  if (entry.compression === 0) return raw.slice();
  if (entry.compression === 8) {
    try {
      return inflateSync(raw, { out: new Uint8Array(uncompSz) });
    } catch {
      return inflateSync(raw);
    }
  }
  return undefined;
}

/** Detect prepended data by checking if the CD signature is at the stored offset. */
function detectOffsetShift(data: Uint8Array, storedCdOffset: number): number {
  if (storedCdOffset < data.length && readU32(data, storedCdOffset) === 0x02014b50) return 0;
  const limit = Math.min(data.length - 4, storedCdOffset + 65536);
  for (let i = storedCdOffset + 1; i <= limit; i++) {
    if (readU32(data, i) === 0x02014b50) return i - storedCdOffset;
  }
  return 0;
}

export function unzip(data: Uint8Array): Record<string, Uint8Array> {
  const eocd = findEOCD(data);
  if (!eocd) diagnoseAndThrow(data);

  let { cdCount, cdOffset } = eocd;
  if (cdOffset === 0xffffffff || cdCount === 0xffff) {
    const zip64 = findZip64EOCD(data, eocd.eocdOffset);
    if (zip64) ({ cdCount, cdOffset } = zip64);
  }

  const shift = detectOffsetShift(data, cdOffset);
  const files: Record<string, Uint8Array> = {};
  const decoder = new TextDecoder();
  let pos = cdOffset + shift;

  for (let i = 0; i < cdCount; i++) {
    const parsed = parseCdEntry(data, pos, decoder);
    if (!parsed) break;
    pos = parsed.next;
    const { entry } = parsed;
    if (entry.filename.endsWith('/')) continue;
    entry.localHeaderOffset += shift;
    const content = extractEntry(data, entry);
    if (content) files[entry.filename] = content;
  }

  if (Object.keys(files).length === 0) diagnoseAndThrow(data);
  return files;
}

function diagnoseAndThrow(bytes: Uint8Array): never {
  if (bytes.length < 4) {
    throw new EpubParseError('Data too small to be a valid EPUB file');
  }
  if (bytes[0] === 0x3c) {
    const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 256)));
    throw new EpubParseError(
      `Expected an EPUB (ZIP) file but received an HTML/XML document. ` +
        `The server may have returned an error page. Starts with: ${JSON.stringify(head.slice(0, 120))}`,
    );
  }
  const hex = Array.from(bytes.subarray(0, 4))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join(' ');
  throw new EpubParseError(
    `Not a valid EPUB (ZIP) file. No ZIP signature found. First bytes: [${hex}]`,
  );
}
