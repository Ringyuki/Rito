import type { ZipLimits } from './types';
import { EpubParseError } from './errors';

export type ResolvedZipLimits = Required<ZipLimits>;

interface ZipEntrySize {
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly localHeaderOffset: number;
  readonly filename: string;
}

export const DEFAULT_ZIP_LIMITS: ResolvedZipLimits = {
  maxArchiveBytes: 512 * 1024 * 1024,
  maxEntries: 10_000,
  maxEntryUncompressedBytes: 128 * 1024 * 1024,
  maxTotalUncompressedBytes: 512 * 1024 * 1024,
  maxCompressionRatio: 200,
};

export function resolveZipLimits(input?: ZipLimits): ResolvedZipLimits {
  const limits: ResolvedZipLimits = {
    maxArchiveBytes: input?.maxArchiveBytes ?? DEFAULT_ZIP_LIMITS.maxArchiveBytes,
    maxEntries: input?.maxEntries ?? DEFAULT_ZIP_LIMITS.maxEntries,
    maxEntryUncompressedBytes:
      input?.maxEntryUncompressedBytes ?? DEFAULT_ZIP_LIMITS.maxEntryUncompressedBytes,
    maxTotalUncompressedBytes:
      input?.maxTotalUncompressedBytes ?? DEFAULT_ZIP_LIMITS.maxTotalUncompressedBytes,
    maxCompressionRatio: input?.maxCompressionRatio ?? DEFAULT_ZIP_LIMITS.maxCompressionRatio,
  };
  validateIntegerLimit('maxArchiveBytes', limits.maxArchiveBytes);
  validateIntegerLimit('maxEntries', limits.maxEntries);
  validateIntegerLimit('maxEntryUncompressedBytes', limits.maxEntryUncompressedBytes);
  validateIntegerLimit('maxTotalUncompressedBytes', limits.maxTotalUncompressedBytes);
  if (!Number.isFinite(limits.maxCompressionRatio) || limits.maxCompressionRatio <= 0) {
    throw new EpubParseError('ZIP limit maxCompressionRatio must be a positive finite number');
  }
  return limits;
}

export function validateZipArchiveSize(size: number, limits: ResolvedZipLimits): void {
  if (size > limits.maxArchiveBytes) {
    throw new EpubParseError(
      `ZIP archive exceeds maxArchiveBytes (${String(limits.maxArchiveBytes)})`,
    );
  }
}

export function validateZipEntrySizes(
  entries: readonly ZipEntrySize[],
  limits: ResolvedZipLimits,
): void {
  let total = 0;
  for (const entry of entries) {
    if (
      !Number.isSafeInteger(entry.compressedSize) ||
      !Number.isSafeInteger(entry.uncompressedSize) ||
      !Number.isSafeInteger(entry.localHeaderOffset)
    ) {
      throw new EpubParseError(`ZIP entry has an unsafe 64-bit size: ${entry.filename}`);
    }
    if (entry.uncompressedSize > limits.maxEntryUncompressedBytes) {
      throw new EpubParseError(
        `ZIP entry exceeds maxEntryUncompressedBytes (${String(limits.maxEntryUncompressedBytes)}): ${entry.filename}`,
      );
    }
    total += entry.uncompressedSize;
    if (!Number.isSafeInteger(total) || total > limits.maxTotalUncompressedBytes) {
      throw new EpubParseError(
        `ZIP archive exceeds maxTotalUncompressedBytes (${String(limits.maxTotalUncompressedBytes)})`,
      );
    }
    const ratio = compressionRatio(entry.uncompressedSize, entry.compressedSize);
    if (ratio > limits.maxCompressionRatio) {
      throw new EpubParseError(
        `ZIP entry exceeds maxCompressionRatio (${String(limits.maxCompressionRatio)}): ${entry.filename}`,
      );
    }
  }
}

function compressionRatio(uncompressed: number, compressed: number): number {
  if (uncompressed === 0) return 0;
  return compressed === 0 ? Infinity : uncompressed / compressed;
}

function validateIntegerLimit(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new EpubParseError(`ZIP limit ${name} must be a positive safe integer`);
  }
}
