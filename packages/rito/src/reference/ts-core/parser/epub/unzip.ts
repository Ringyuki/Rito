// ZIP decompressor for EPUB archives.
//
// The central directory is fully validated against configured resource budgets
// before any entry is allocated or inflated. Raw DEFLATE decoding is delegated
// to fflate after the declared output size has passed those checks.

import { normalizeArchiveEntryPath } from './archive-path';
import { EpubParseError } from './errors';
import type { ZipLimits } from './types';
import { decodeZipFilename } from './zip-filename';
import { diagnoseInvalidZip } from './zip-diagnostics';
import { inflateEntry } from './zip-inflate';
import { resolveZipLimits, validateZipArchiveSize, validateZipEntrySizes } from './zip-limits';

function readU16(data: Uint8Array, offset: number): number {
  return (data[offset] ?? 0) | ((data[offset + 1] ?? 0) << 8);
}

function readU32(data: Uint8Array, offset: number): number {
  return (
    ((data[offset] ?? 0) |
      ((data[offset + 1] ?? 0) << 8) |
      ((data[offset + 2] ?? 0) << 16) |
      ((data[offset + 3] ?? 0) << 24)) >>>
    0
  );
}

function readU64(data: Uint8Array, offset: number): number {
  return readU32(data, offset + 4) * 0x1_0000_0000 + readU32(data, offset);
}

interface EndOfCentralDirectory {
  readonly cdCount: number;
  readonly cdOffset: number;
  readonly eocdOffset: number;
  readonly disk: number;
  readonly centralDirectoryDisk: number;
  readonly diskEntryCount: number;
}

function findEocd(data: Uint8Array): EndOfCentralDirectory | undefined {
  const minPosition = Math.max(0, data.length - 22 - 65_535);
  for (let offset = data.length - 22; offset >= minPosition; offset--) {
    if (readU32(data, offset) !== 0x06054b50) continue;
    return {
      disk: readU16(data, offset + 4),
      centralDirectoryDisk: readU16(data, offset + 6),
      diskEntryCount: readU16(data, offset + 8),
      cdCount: readU16(data, offset + 10),
      cdOffset: readU32(data, offset + 16),
      eocdOffset: offset,
    };
  }
  return undefined;
}

function findZip64Eocd(
  data: Uint8Array,
  eocdOffset: number,
): { cdCount: number; cdOffset: number } | undefined {
  const locatorPosition = eocdOffset - 20;
  if (locatorPosition < 0 || readU32(data, locatorPosition) !== 0x07064b50) return undefined;

  const zip64Offset = readU64(data, locatorPosition + 8);
  if (!Number.isSafeInteger(zip64Offset) || zip64Offset + 56 > data.length) return undefined;
  if (readU32(data, zip64Offset) !== 0x06064b50) return undefined;

  return { cdCount: readU64(data, zip64Offset + 32), cdOffset: readU64(data, zip64Offset + 48) };
}

function parseZip64Extra(
  extra: Uint8Array,
  uncompressed: number,
  compressed: number,
  localOffset: number,
): { uncompressed: number; compressed: number; localOffset: number } {
  let position = 0;
  while (position + 4 <= extra.length) {
    const id = readU16(extra, position);
    const size = readU16(extra, position + 2);
    const end = position + 4 + size;
    if (end > extra.length) break;
    if (id === 0x0001) {
      let fieldPosition = position + 4;
      let resolvedUncompressed = uncompressed;
      let resolvedCompressed = compressed;
      let resolvedOffset = localOffset;
      if (uncompressed === 0xffffffff && fieldPosition + 8 <= end) {
        resolvedUncompressed = readU64(extra, fieldPosition);
        fieldPosition += 8;
      }
      if (compressed === 0xffffffff && fieldPosition + 8 <= end) {
        resolvedCompressed = readU64(extra, fieldPosition);
        fieldPosition += 8;
      }
      if (localOffset === 0xffffffff && fieldPosition + 8 <= end) {
        resolvedOffset = readU64(extra, fieldPosition);
      }
      return {
        uncompressed: resolvedUncompressed,
        compressed: resolvedCompressed,
        localOffset: resolvedOffset,
      };
    }
    position = end;
  }
  return { uncompressed, compressed, localOffset };
}

interface CentralDirectoryEntry {
  readonly flags: number;
  readonly compression: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  localHeaderOffset: number;
  readonly filename: string;
  readonly isDirectory: boolean;
}

function readCentralDirectorySizes(
  data: Uint8Array,
  position: number,
  filenameLength: number,
  extraLength: number,
): { compressedSize: number; uncompressedSize: number; localHeaderOffset: number } {
  let compressedSize = readU32(data, position + 20);
  let uncompressedSize = readU32(data, position + 24);
  let localHeaderOffset = readU32(data, position + 42);
  if (
    compressedSize !== 0xffffffff &&
    uncompressedSize !== 0xffffffff &&
    localHeaderOffset !== 0xffffffff
  ) {
    return { compressedSize, uncompressedSize, localHeaderOffset };
  }
  const extraStart = position + 46 + filenameLength;
  const zip64 = parseZip64Extra(
    data.subarray(extraStart, extraStart + extraLength),
    uncompressedSize,
    compressedSize,
    localHeaderOffset,
  );
  compressedSize = zip64.compressed;
  uncompressedSize = zip64.uncompressed;
  localHeaderOffset = zip64.localOffset;
  return { compressedSize, uncompressedSize, localHeaderOffset };
}

function parseCentralDirectoryEntry(
  data: Uint8Array,
  position: number,
): { entry: CentralDirectoryEntry; next: number } | undefined {
  if (position + 46 > data.length || readU32(data, position) !== 0x02014b50) return undefined;

  const filenameLength = readU16(data, position + 28);
  const extraLength = readU16(data, position + 30);
  const commentLength = readU16(data, position + 32);
  const next = position + 46 + filenameLength + extraLength + commentLength;
  if (!Number.isSafeInteger(next) || next > data.length) return undefined;

  const filenameBytes = data.subarray(position + 46, position + 46 + filenameLength);
  const flags = readU16(data, position + 8);
  const decodedFilename = decodeZipFilename(filenameBytes, flags);
  const isDirectory = decodedFilename.endsWith('/');
  const filename = normalizeArchiveEntryPath(decodedFilename);

  const { compressedSize, uncompressedSize, localHeaderOffset } = readCentralDirectorySizes(
    data,
    position,
    filenameLength,
    extraLength,
  );

  return {
    entry: {
      flags,
      compression: readU16(data, position + 10),
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      filename,
      isDirectory,
    },
    next,
  };
}

function extractEntry(data: Uint8Array, entry: CentralDirectoryEntry): Uint8Array | undefined {
  if ((entry.flags & 1) !== 0) {
    throw new EpubParseError(`Encrypted ZIP entries are unsupported: ${entry.filename}`);
  }
  if (entry.compression !== 0 && entry.compression !== 8) return undefined;

  const localHeader = entry.localHeaderOffset;
  if (localHeader + 30 > data.length || readU32(data, localHeader) !== 0x04034b50) {
    throw new EpubParseError(`Invalid local ZIP header for entry: ${entry.filename}`);
  }

  const dataStart =
    localHeader + 30 + readU16(data, localHeader + 26) + readU16(data, localHeader + 28);
  const dataEnd = dataStart + entry.compressedSize;
  if (!Number.isSafeInteger(dataEnd) || dataEnd > data.length) {
    throw new EpubParseError(`Truncated ZIP entry data: ${entry.filename}`);
  }

  const raw = data.subarray(dataStart, dataEnd);
  if (entry.compression === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) {
      throw new EpubParseError(`Stored ZIP entry has inconsistent sizes: ${entry.filename}`);
    }
    return raw.slice();
  }

  try {
    return inflateEntry(raw, entry.uncompressedSize, entry.filename);
  } catch (error) {
    if (error instanceof EpubParseError) throw error;
    throw new EpubParseError(`Failed to inflate ZIP entry: ${entry.filename}`);
  }
}

function detectOffsetShift(data: Uint8Array, storedCentralDirectoryOffset: number): number {
  if (
    storedCentralDirectoryOffset < data.length &&
    readU32(data, storedCentralDirectoryOffset) === 0x02014b50
  ) {
    return 0;
  }
  const limit = Math.min(data.length - 4, storedCentralDirectoryOffset + 65_536);
  for (let offset = storedCentralDirectoryOffset + 1; offset <= limit; offset++) {
    if (readU32(data, offset) === 0x02014b50) return offset - storedCentralDirectoryOffset;
  }
  return 0;
}

export function unzip(data: Uint8Array, inputLimits?: ZipLimits): Record<string, Uint8Array> {
  const limits = resolveZipLimits(inputLimits);
  validateZipArchiveSize(data.length, limits);

  const eocd = findEocd(data);
  if (!eocd) diagnoseInvalidZip(data);
  if (eocd.disk !== 0 || eocd.centralDirectoryDisk !== 0 || eocd.diskEntryCount !== eocd.cdCount) {
    throw new EpubParseError('Multi-disk ZIP archives are unsupported');
  }

  let { cdCount, cdOffset } = eocd;
  if (cdOffset === 0xffffffff || cdCount === 0xffff) {
    const zip64 = findZip64Eocd(data, eocd.eocdOffset);
    if (!zip64) throw new EpubParseError('Invalid ZIP64 central directory');
    ({ cdCount, cdOffset } = zip64);
  }
  if (!Number.isSafeInteger(cdCount) || cdCount > limits.maxEntries) {
    throw new EpubParseError(`ZIP archive exceeds maxEntries (${String(limits.maxEntries)})`);
  }

  const shift = detectOffsetShift(data, cdOffset);
  const entries: CentralDirectoryEntry[] = [];
  const seenPaths = new Set<string>();
  let position = cdOffset + shift;
  for (let index = 0; index < cdCount; index++) {
    const parsed = parseCentralDirectoryEntry(data, position);
    if (!parsed) throw new EpubParseError('Invalid or truncated ZIP central directory');
    position = parsed.next;
    parsed.entry.localHeaderOffset += shift;
    if (seenPaths.has(parsed.entry.filename)) {
      throw new EpubParseError(`Duplicate ZIP entry path: ${parsed.entry.filename}`);
    }
    seenPaths.add(parsed.entry.filename);
    entries.push(parsed.entry);
  }

  validateZipEntrySizes(entries, limits);
  const files = Object.create(null) as Record<string, Uint8Array>;
  for (const entry of entries) {
    if (entry.isDirectory) continue;
    const content = extractEntry(data, entry);
    if (content) files[entry.filename] = content;
  }

  if (Object.keys(files).length === 0) diagnoseInvalidZip(data);
  return files;
}
