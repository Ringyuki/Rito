import { describe, expect, it } from 'vitest';
import { buildHrefResolver } from '../../src/utils/resolve-href';

describe('buildHrefResolver', () => {
  it('resolves by exact match', () => {
    const resources = new Map([['Images/cover.jpg', 'blob:cover']]);
    const resolve = buildHrefResolver(resources);

    expect(resolve('Images/cover.jpg')).toBe('blob:cover');
  });

  it('resolves by suffix match', () => {
    const resources = new Map([['Images/cover.jpg', 'blob:cover']]);
    const resolve = buildHrefResolver(resources);

    expect(resolve('../Images/cover.jpg')).toBe('blob:cover');
  });

  it('resolves by unique basename', () => {
    const resources = new Map([['OEBPS/Images/photo.png', 'blob:photo']]);
    const resolve = buildHrefResolver(resources);

    expect(resolve('photo.png')).toBe('blob:photo');
  });

  it('returns undefined for ambiguous basename', () => {
    const resources = new Map([
      ['chapter1/image.png', 'blob:img1'],
      ['chapter2/image.png', 'blob:img2'],
    ]);
    const resolve = buildHrefResolver(resources);

    // Suffix match hits first for bare basenames; use a path that defeats suffix
    // matching but still shares the ambiguous basename.
    expect(resolve('other/image.png')).toBeUndefined();
  });

  it('returns undefined when no match exists', () => {
    const resources = new Map([['Images/cover.jpg', 'blob:cover']]);
    const resolve = buildHrefResolver(resources);

    expect(resolve('missing.png')).toBeUndefined();
  });

  it('returns undefined for empty map', () => {
    const resolve = buildHrefResolver(new Map());

    expect(resolve('anything.jpg')).toBeUndefined();
  });

  it('prefers exact match over suffix match', () => {
    const resources = new Map([
      ['Images/cover.jpg', 'blob:exact'],
      ['OtherDir/Images/cover.jpg', 'blob:other'],
    ]);
    const resolve = buildHrefResolver(resources);

    expect(resolve('Images/cover.jpg')).toBe('blob:exact');
  });
});
