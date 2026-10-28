import type { BrowserReaderResource } from './reader-session';
import { BrowserReaderCanvasUnsupportedError } from './reader-session-canvas-error';
import {
  BrowserReaderCanvasImageBudgetExceededError,
  type BrowserReaderCanvasImageLimits,
} from './reader-session-canvas-image-limits';

export interface BrowserReaderCanvasImageSource {
  readonly width: number;
  readonly height: number;
  readonly mediaType: 'image/png' | 'image/gif' | 'image/webp' | 'image/bmp' | 'image/jpeg';
}

type Dimensions = { readonly width: number; readonly height: number };

const JPEG_HEADER_SCAN_BYTES_MAX = 1024 * 1024;

export function inspectBrowserReaderCanvasImage(
  resource: BrowserReaderResource,
  limits: BrowserReaderCanvasImageLimits,
): BrowserReaderCanvasImageSource {
  const declared = declaredDimensions(resource);
  const detected = detectDimensions(resource.bytes, declared);
  if (!detected) {
    const mediaType = resource.mediaType.trim().toLowerCase().split(';', 1)[0] ?? '';
    throw new BrowserReaderCanvasUnsupportedError(`image-format:${mediaType || 'unknown'}`);
  }
  if (declared && (declared.width !== detected.width || declared.height !== detected.height)) {
    throw new Error(
      `reader session image dimensions do not match Core metadata for ${resource.href}.`,
    );
  }
  validateDimensions(detected, limits, resource.href);
  return detected;
}

function declaredDimensions(
  resource: BrowserReaderResource,
): { readonly width: number; readonly height: number } | undefined {
  if ((resource.width === undefined) !== (resource.height === undefined)) {
    throw new Error(`reader session image ${resource.href} has incomplete Core dimensions.`);
  }
  if (resource.width === undefined || resource.height === undefined) return undefined;
  if (!Number.isSafeInteger(resource.width) || !Number.isSafeInteger(resource.height)) {
    throw new Error(`reader session image ${resource.href} has invalid Core dimensions.`);
  }
  return { width: resource.width, height: resource.height };
}

/**
 * The format and size of an image the browser can decode, by its bytes:
 * the formats Core sizes (PNG, GIF, WebP, BMP, JPEG), read the way Core
 * reads them.
 */
function detectDimensions(
  bytes: Uint8Array,
  declared: Dimensions | undefined,
): BrowserReaderCanvasImageSource | undefined {
  const sized = (
    dimensions: Dimensions | undefined,
    mediaType: BrowserReaderCanvasImageSource['mediaType'],
  ): BrowserReaderCanvasImageSource | undefined =>
    dimensions ? { ...dimensions, mediaType } : undefined;
  if (isPng(bytes)) return sized(pngDimensions(bytes), 'image/png');
  if (isGif(bytes)) return sized(gifDimensions(bytes), 'image/gif');
  if (isWebp(bytes)) return sized(webpDimensions(bytes), 'image/webp');
  if (isBmp(bytes)) return sized(bmpDimensions(bytes), 'image/bmp');
  if (!isJpeg(bytes)) return undefined;
  return sized(declared ?? jpegDimensions(bytes), 'image/jpeg');
}

function isGif(bytes: Uint8Array): boolean {
  const signature = ascii(bytes, 0, 6);
  return bytes.length >= 10 && (signature === 'GIF87a' || signature === 'GIF89a');
}

function gifDimensions(bytes: Uint8Array): Dimensions {
  return { width: readU16Le(bytes, 6), height: readU16Le(bytes, 8) };
}

function isWebp(bytes: Uint8Array): boolean {
  return bytes.length >= 30 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP';
}

function webpDimensions(bytes: Uint8Array): Dimensions | undefined {
  switch (ascii(bytes, 12, 4)) {
    // Extended: 24-bit canvas width and height, less one.
    case 'VP8X':
      return { width: readU24Le(bytes, 24) + 1, height: readU24Le(bytes, 27) + 1 };
    // Lossless: 14-bit fields packed after the one-byte signature.
    case 'VP8L': {
      if (bytes[20] !== 0x2f) return undefined;
      const packed = readU16Le(bytes, 21) + readU16Le(bytes, 23) * 0x10000;
      return { width: (packed & 0x3fff) + 1, height: (Math.floor(packed / 0x4000) & 0x3fff) + 1 };
    }
    // Lossy: the frame header past its start code.
    case 'VP8 ':
      if (bytes[23] !== 0x9d || bytes[24] !== 0x01 || bytes[25] !== 0x2a) return undefined;
      return { width: readU16Le(bytes, 26) & 0x3fff, height: readU16Le(bytes, 28) & 0x3fff };
    default:
      return undefined;
  }
}

function isBmp(bytes: Uint8Array): boolean {
  return bytes.length >= 26 && ascii(bytes, 0, 2) === 'BM';
}

function bmpDimensions(bytes: Uint8Array): Dimensions | undefined {
  const width = readI32Le(bytes, 18);
  // A negative height encodes a top-down bitmap.
  const height = Math.abs(readI32Le(bytes, 22));
  return width > 0 && height > 0 ? { width, height } : undefined;
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

function readU16Le(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] ?? 0) | ((bytes[offset + 1] ?? 0) << 8);
}

function readU24Le(bytes: Uint8Array, offset: number): number {
  return readU16Le(bytes, offset) + (bytes[offset + 2] ?? 0) * 0x10000;
}

function readI32Le(bytes: Uint8Array, offset: number): number {
  return readU16Le(bytes, offset) | (readU16Le(bytes, offset + 2) << 16);
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
  limits: BrowserReaderCanvasImageLimits,
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
    throw new BrowserReaderCanvasImageBudgetExceededError(
      `reader session image ${href} exceeds the source dimension budget.`,
    );
  }
}
