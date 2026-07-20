import type { BrowserReaderResourceV1 } from './reader-v1';
import { BrowserReaderCanvasUnsupportedErrorV1 } from './reader-v1-canvas-error';
import {
  BrowserReaderCanvasImageBudgetExceededErrorV1,
  type BrowserReaderCanvasImageLimitsV1,
} from './reader-v1-canvas-image-limits';

export interface BrowserReaderCanvasImageSourceV1 {
  readonly width: number;
  readonly height: number;
  readonly mediaType: 'image/png' | 'image/jpeg';
}

const JPEG_HEADER_SCAN_BYTES_MAX = 1024 * 1024;

export function inspectBrowserReaderCanvasImageV1(
  resource: BrowserReaderResourceV1,
  limits: BrowserReaderCanvasImageLimitsV1,
): BrowserReaderCanvasImageSourceV1 {
  const declared = declaredDimensions(resource);
  const detected = detectDimensions(resource.bytes, declared);
  if (!detected) {
    const mediaType = resource.mediaType.trim().toLowerCase().split(';', 1)[0] ?? '';
    throw new BrowserReaderCanvasUnsupportedErrorV1(`image-format:${mediaType || 'unknown'}`);
  }
  if (declared && (declared.width !== detected.width || declared.height !== detected.height)) {
    throw new Error(`Reader v1 image dimensions do not match Core metadata for ${resource.href}.`);
  }
  validateDimensions(detected, limits, resource.href);
  return detected;
}

function declaredDimensions(
  resource: BrowserReaderResourceV1,
): { readonly width: number; readonly height: number } | undefined {
  if ((resource.width === undefined) !== (resource.height === undefined)) {
    throw new Error(`Reader v1 image ${resource.href} has incomplete Core dimensions.`);
  }
  if (resource.width === undefined || resource.height === undefined) return undefined;
  if (!Number.isSafeInteger(resource.width) || !Number.isSafeInteger(resource.height)) {
    throw new Error(`Reader v1 image ${resource.href} has invalid Core dimensions.`);
  }
  return { width: resource.width, height: resource.height };
}

function detectDimensions(
  bytes: Uint8Array,
  declared: { readonly width: number; readonly height: number } | undefined,
): BrowserReaderCanvasImageSourceV1 | undefined {
  if (isPng(bytes)) {
    const dimensions = pngDimensions(bytes);
    return dimensions ? { ...dimensions, mediaType: 'image/png' } : undefined;
  }
  if (!isJpeg(bytes)) return undefined;
  const dimensions = declared ?? jpegDimensions(bytes);
  return dimensions ? { ...dimensions, mediaType: 'image/jpeg' } : undefined;
}

function isPng(bytes: Uint8Array): boolean {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  return (
    bytes.length >= signature.length && signature.every((value, index) => bytes[index] === value)
  );
}

function pngDimensions(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | undefined {
  if (bytes.length < 24 || ascii(bytes, 12, 4) !== 'IHDR') return undefined;
  return { width: readU32Be(bytes, 16), height: readU32Be(bytes, 20) };
}

function isJpeg(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
}

function jpegDimensions(
  bytes: Uint8Array,
): { readonly width: number; readonly height: number } | undefined {
  const limit = Math.min(bytes.length, JPEG_HEADER_SCAN_BYTES_MAX);
  let offset = 2;
  while (offset + 3 < limit) {
    while (offset < limit && bytes[offset] !== 0xff) offset += 1;
    while (offset < limit && bytes[offset] === 0xff) offset += 1;
    if (offset >= limit) return undefined;
    const marker = bytes[offset] ?? 0;
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;
    if (offset + 1 >= limit) return undefined;
    const length = readU16Be(bytes, offset);
    if (length < 2 || offset + length > limit) return undefined;
    if (isStartOfFrame(marker)) {
      if (length < 7) return undefined;
      return {
        width: readU16Be(bytes, offset + 5),
        height: readU16Be(bytes, offset + 3),
      };
    }
    offset += length;
  }
  return undefined;
}

function isStartOfFrame(marker: number): boolean {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
}

function readU16Be(bytes: Uint8Array, offset: number): number {
  return ((bytes[offset] ?? 0) << 8) | (bytes[offset + 1] ?? 0);
}

function readU32Be(bytes: Uint8Array, offset: number): number {
  return (
    (bytes[offset] ?? 0) * 0x1000000 +
    (bytes[offset + 1] ?? 0) * 0x10000 +
    (bytes[offset + 2] ?? 0) * 0x100 +
    (bytes[offset + 3] ?? 0)
  );
}

function ascii(bytes: Uint8Array, offset: number, length: number): string {
  let value = '';
  for (let index = offset; index < offset + length; index += 1) {
    value += String.fromCharCode(bytes[index] ?? 0);
  }
  return value;
}

function validateDimensions(
  dimensions: { readonly width: number; readonly height: number },
  limits: BrowserReaderCanvasImageLimitsV1,
  href: string,
): void {
  const { width, height } = dimensions;
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    width <= 0 ||
    height <= 0 ||
    width > limits.maxSourceDimension ||
    height > limits.maxSourceDimension ||
    width * height > limits.maxSourcePixels
  ) {
    throw new BrowserReaderCanvasImageBudgetExceededErrorV1(
      `Reader v1 image ${href} exceeds the source dimension budget.`,
    );
  }
}
