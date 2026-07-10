import { describe, expect, it } from 'vitest';

import { createCanvasImageResolver } from '../../src/bindings/browser/image-href-resolver';
import { buildHrefResolver as buildReferenceHrefResolver } from '../../src/reference/ts-core/utils/resolve-href';

describe('browser image href resolver', () => {
  it('resolves exact, relative, suffix, basename, and percent-encoded hrefs', () => {
    const cover = imageBitmap('cover');
    const photo = imageBitmap('photo');
    const spaced = imageBitmap('spaced');
    const resolve = createCanvasImageResolver(
      new Map([
        ['Images/cover.jpg', cover],
        ['OEBPS/Media/photo.png', photo],
        ['Images/My Pic.jpg', spaced],
      ]),
    );

    expect(resolve('Images/cover.jpg')).toBe(cover);
    expect(resolve('../Images/cover.jpg')).toBe(cover);
    expect(resolve('../../../Images/cover.jpg')).toBe(cover);
    expect(resolve('OPS/Images/cover.jpg')).toBe(cover);
    expect(resolve('photo.png')).toBe(photo);
    expect(resolve('../Images/My%20Pic.jpg')).toBe(spaced);
  });

  it('does not guess when a suffix or basename is ambiguous', () => {
    const first = imageBitmap('first');
    const second = imageBitmap('second');
    const resolve = createCanvasImageResolver(
      new Map([
        ['OPS-1/Images/cover.jpg', first],
        ['OPS-2/Images/cover.jpg', second],
      ]),
    );

    expect(resolve('Images/cover.jpg')).toBeUndefined();
    expect(resolve('other/cover.jpg')).toBeUndefined();
    expect(resolve('OPS-1/Images/cover.jpg')).toBe(first);
  });

  it('returns undefined for missing and malformed percent-encoded hrefs', () => {
    const resolve = createCanvasImageResolver(
      new Map([['Images/cover.jpg', imageBitmap('cover')]]),
    );

    expect(resolve('missing.jpg')).toBeUndefined();
    expect(resolve('Images/%ZZcover.jpg')).toBeUndefined();
    expect(createCanvasImageResolver(new Map())('anything.jpg')).toBeUndefined();
  });

  it('matches the reference resolver across the compatibility lookup matrix', () => {
    const images = new Map([
      ['Images/cover.jpg', imageBitmap('cover')],
      ['Other/Images/cover.jpg', imageBitmap('other-cover')],
      ['OPS/Media/photo.png', imageBitmap('photo')],
      ['Images/My Pic.jpg', imageBitmap('spaced')],
    ]);
    const production = createCanvasImageResolver(images);
    const reference = buildReferenceHrefResolver(images);
    const sources = [
      'Images/cover.jpg',
      '../Images/cover.jpg',
      '../../../OPS/Media/photo.png',
      'root/OPS/Media/photo.png',
      'photo.png',
      'cover.jpg',
      '../Images/My%20Pic.jpg',
      'Images/%ZZcover.jpg',
      './Images/cover.jpg',
      'Images/cover.jpg?size=2',
      'Images\\cover.jpg',
      'missing.png',
    ];

    for (const source of sources) expect(production(source)).toBe(reference(source));
  });
});

function imageBitmap(id: string): ImageBitmap {
  return { id } as unknown as ImageBitmap;
}
