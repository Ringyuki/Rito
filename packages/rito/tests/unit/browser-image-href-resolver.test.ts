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

  it('prefers a stripped exact path before a longer resource suffix', () => {
    const exact = imageBitmap('exact');
    const suffix = imageBitmap('suffix');
    const images = new Map([
      ['Images/cover.jpg', exact],
      ['Other/Images/cover.jpg', suffix],
    ]);

    expect(createCanvasImageResolver(images)('../Images/cover.jpg')).toBe(exact);
    expect(buildReferenceHrefResolver(images)('../Images/cover.jpg')).toBe(exact);
  });

  it('resolves literal sources against percent-encoded resource keys', () => {
    const image = imageBitmap('encoded-key');
    const images = new Map([['Images/My%20Pic.jpg', image]]);

    expect(createCanvasImageResolver(images)('../Images/My Pic.jpg')).toBe(image);
    expect(buildReferenceHrefResolver(images)('../Images/My Pic.jpg')).toBe(image);
  });

  it('keeps raw precedence and rejects unsafe alias fallbacks', () => {
    const encoded = imageBitmap('encoded');
    const literal = imageBitmap('literal');
    const aliases = new Map([
      ['Images/My%20Pic.jpg', encoded],
      ['Images/My Pic.jpg', literal],
    ]);

    for (const resolve of [
      createCanvasImageResolver(aliases),
      buildReferenceHrefResolver(aliases),
    ]) {
      expect(resolve('Images/My%20Pic.jpg')).toBe(encoded);
      expect(resolve('Images/My Pic.jpg')).toBe(literal);
      expect(resolve('Images/My%20%50ic.jpg')).toBeUndefined();
    }

    const doubleEncoded = new Map([['Images/My%2520Pic.jpg', encoded]]);
    const malformedAlias = new Map([['Images/100%25.jpg', encoded]]);
    for (const build of [createCanvasImageResolver, buildReferenceHrefResolver]) {
      expect(build(doubleEncoded)('Images/My%20Pic.jpg')).toBeUndefined();
      expect(build(malformedAlias)('Images/100%.jpg')).toBeUndefined();
    }

    const shorterFallback = new Map([
      ['A%2Fpic.jpg', encoded],
      ['A/pic.jpg', literal],
      ['pic.jpg', imageBitmap('shorter')],
    ]);
    for (const build of [createCanvasImageResolver, buildReferenceHrefResolver]) {
      expect(build(shorterFallback)('A/%70ic.jpg')).toBeUndefined();
    }
  });

  it('resolves query and fragment aliases without hiding collisions', () => {
    const plain = imageBitmap('plain');
    const queried = imageBitmap('queried');

    for (const build of [createCanvasImageResolver, buildReferenceHrefResolver]) {
      const resolvePlain = build(new Map([['Images/My%20Pic.jpg?manifest=%zz', plain]]));
      expect(resolvePlain('../Images/My Pic.jpg?cache=%zz#view')).toBe(plain);
      expect(resolvePlain('../Images/My Pic.jpg#view')).toBe(plain);

      const resolveCollision = build(
        new Map([
          ['A/pic.jpg', plain],
          ['A/pic.jpg?edition=2', queried],
          ['pic.jpg', imageBitmap('shorter')],
        ]),
      );
      expect(resolveCollision('A/pic.jpg?edition=2')).toBe(queried);
      expect(resolveCollision('A/pic.jpg#view')).toBeUndefined();
      expect(build(new Map([['Images/a%3Fb.jpg', plain]]))('Images/a?b.jpg')).toBeUndefined();

      const resolveCover = build(new Map([['Images/cover.jpg', plain]]));
      expect(resolveCover('missing.jpg?fallback=/Images/cover.jpg')).toBeUndefined();
      expect(resolveCover('missing.jpg#fallback/Images/cover.jpg')).toBeUndefined();
      expect(
        build(new Map([['missing.jpg?fallback=/Images/cover.jpg', plain]]))('Images/cover.jpg'),
      ).toBeUndefined();
    }
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
