import { describe, expect, it } from 'vitest';
import { extractImageDimensions } from '../golden-books/helpers/image-dimensions';

describe('golden image dimensions', () => {
  it('extracts PNG and JPEG intrinsic sizes for pagination fixtures', () => {
    const images = extractImageDimensions(
      new Map([
        ['Images/cover.png', pngHeader(320, 480)],
        ['Images/photo.jpg', jpegHeader(640, 360)],
        ['Images/unsupported.gif', new Uint8Array([0])],
      ]),
    );

    expect(images.get('Images/cover.png')).toEqual({ width: 320, height: 480 });
    expect(images.get('Images/photo.jpg')).toEqual({ width: 640, height: 360 });
    expect(images.has('Images/unsupported.gif')).toBe(false);
  });
});

function pngHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(24);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
  bytes.set([0x49, 0x48, 0x44, 0x52], 12);
  writeU32be(bytes, 16, width);
  writeU32be(bytes, 20, height);
  return bytes;
}

function jpegHeader(width: number, height: number): Uint8Array {
  const bytes = new Uint8Array(21);
  bytes.set([0xff, 0xd8, 0xff, 0xc0], 0);
  writeU16be(bytes, 4, 17);
  bytes[6] = 8;
  writeU16be(bytes, 7, height);
  writeU16be(bytes, 9, width);
  return bytes;
}

function writeU16be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 8) & 0xff;
  bytes[offset + 1] = value & 0xff;
}

function writeU32be(bytes: Uint8Array, offset: number, value: number): void {
  bytes[offset] = (value >> 24) & 0xff;
  bytes[offset + 1] = (value >> 16) & 0xff;
  bytes[offset + 2] = (value >> 8) & 0xff;
  bytes[offset + 3] = value & 0xff;
}
