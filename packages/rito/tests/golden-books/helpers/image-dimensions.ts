import type { ImageDimensions } from '../../../src/reference/ts-core/layout/core/types';

export function extractImageDimensions(
  images: ReadonlyMap<string, Uint8Array>,
): ReadonlyMap<string, ImageDimensions> {
  const dimensions = new Map<string, ImageDimensions>();
  for (const [href, bytes] of images) {
    const size = parseImageDimensions(bytes);
    if (size) dimensions.set(href, size);
  }
  return dimensions;
}

function parseImageDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  return parsePngDimensions(bytes) ?? parseJpegDimensions(bytes);
}

function parsePngDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.byteLength < 24) return undefined;
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!signature.every((byte, index) => bytes[index] === byte)) return undefined;
  if (readAscii(bytes, 12, 4) !== 'IHDR') return undefined;
  return {
    width: readU32be(bytes, 16),
    height: readU32be(bytes, 20),
  };
}

function parseJpegDimensions(bytes: Uint8Array): ImageDimensions | undefined {
  if (bytes.byteLength < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return undefined;
  let offset = 2;
  while (offset + 3 < bytes.byteLength) {
    while (offset < bytes.byteLength && bytes[offset] !== 0xff) offset++;
    while (offset < bytes.byteLength && bytes[offset] === 0xff) offset++;
    if (offset >= bytes.byteLength) return undefined;

    const marker = bytes[offset];
    if (marker === undefined) return undefined;
    offset++;
    if (marker === 0xd9 || marker === 0xda) return undefined;
    if (offset + 1 >= bytes.byteLength) return undefined;
    const segmentLength = readU16be(bytes, offset);
    if (segmentLength < 2 || offset + segmentLength > bytes.byteLength) return undefined;
    if (isJpegSofMarker(marker) && segmentLength >= 7) {
      return {
        height: readU16be(bytes, offset + 3),
        width: readU16be(bytes, offset + 5),
      };
    }
    offset += segmentLength;
  }
  return undefined;
}

function isJpegSofMarker(marker: number): boolean {
  return (
    (marker >= 0xc0 && marker <= 0xc3) ||
    (marker >= 0xc5 && marker <= 0xc7) ||
    (marker >= 0xc9 && marker <= 0xcb) ||
    (marker >= 0xcd && marker <= 0xcf)
  );
}

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readU16be(bytes: Uint8Array, offset: number): number {
  return viewFor(bytes, offset, 2).getUint16(0, false);
}

function readU32be(bytes: Uint8Array, offset: number): number {
  return viewFor(bytes, offset, 4).getUint32(0, false);
}

function viewFor(bytes: Uint8Array, offset: number, length: number): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, length);
}
