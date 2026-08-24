import { describe, expect, it } from 'vitest';
import { buildHrefResolver } from '../../src/reference/ts-core/utils/resolve-href';

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

  it('prefers a stripped exact path over a longer resource suffix', () => {
    const resolve = buildHrefResolver(
      new Map([
        ['Images/cover.jpg', 'blob:exact'],
        ['Other/Images/cover.jpg', 'blob:suffix'],
      ]),
    );

    expect(resolve('../Images/cover.jpg')).toBe('blob:exact');
  });

  it('resolves a percent-encoded src to a literal key', () => {
    const resources = new Map([['Images/My Pic.jpg', 'blob:pic']]);
    const resolve = buildHrefResolver(resources);

    expect(resolve('Images/My%20Pic.jpg')).toBe('blob:pic');
    expect(resolve('../Images/My%20Pic.jpg')).toBe('blob:pic');
  });

  it('resolves a literal src to a percent-encoded key', () => {
    const resolve = buildHrefResolver(new Map([['Images/My%20Pic.jpg', 'blob:pic']]));

    expect(resolve('../Images/My Pic.jpg')).toBe('blob:pic');
  });

  it('preserves raw keys before rejecting decoded alias collisions', () => {
    const resolve = buildHrefResolver(
      new Map([
        ['Images/My%20Pic.jpg', 'blob:encoded'],
        ['Images/My Pic.jpg', 'blob:literal'],
      ]),
    );

    expect(resolve('Images/My%20Pic.jpg')).toBe('blob:encoded');
    expect(resolve('Images/My Pic.jpg')).toBe('blob:literal');
    expect(resolve('Images/My%20%50ic.jpg')).toBeUndefined();
  });

  it('does not double-decode aliases or alias malformed sources', () => {
    const doubleEncoded = buildHrefResolver(new Map([['Images/My%2520Pic.jpg', 'blob:double']]));
    const malformedAlias = buildHrefResolver(new Map([['Images/100%25.jpg', 'blob:percent']]));

    expect(doubleEncoded('Images/My%20Pic.jpg')).toBeUndefined();
    expect(malformedAlias('Images/100%.jpg')).toBeUndefined();
  });

  it('does not use a shorter fallback after an alias collision', () => {
    const resolve = buildHrefResolver(
      new Map([
        ['A%2Fpic.jpg', 'blob:encoded'],
        ['A/pic.jpg', 'blob:literal'],
        ['pic.jpg', 'blob:shorter'],
      ]),
    );

    expect(resolve('A/%70ic.jpg')).toBeUndefined();
  });

  it('resolves query and fragment aliases symmetrically', () => {
    const resolve = buildHrefResolver(new Map([['Images/My%20Pic.jpg?manifest=%zz', 'blob:pic']]));

    expect(resolve('../Images/My Pic.jpg?cache=%zz#view')).toBe('blob:pic');
    expect(resolve('../Images/My Pic.jpg#view')).toBe('blob:pic');
  });

  it('keeps raw query precedence and rejects canonical collisions', () => {
    const resolve = buildHrefResolver(
      new Map([
        ['A/pic.jpg', 'blob:plain'],
        ['A/pic.jpg?edition=2', 'blob:queried'],
        ['pic.jpg', 'blob:shorter'],
      ]),
    );

    expect(resolve('A/pic.jpg?edition=2')).toBe('blob:queried');
    expect(resolve('A/pic.jpg#view')).toBeUndefined();
  });

  it('ignores path separators inside query and fragment suffixes', () => {
    const resolve = buildHrefResolver(new Map([['Images/cover.jpg', 'blob:cover']]));

    expect(resolve('missing.jpg?fallback=/Images/cover.jpg')).toBeUndefined();
    expect(resolve('missing.jpg#fallback/Images/cover.jpg')).toBeUndefined();
    expect(
      buildHrefResolver(new Map([['missing.jpg?fallback=/Images/cover.jpg', 'blob:polluted']]))(
        'Images/cover.jpg',
      ),
    ).toBeUndefined();
  });

  it('does not strip encoded delimiters after decoding the path', () => {
    const resolveQuery = buildHrefResolver(new Map([['Images/a%3Fb.jpg', 'blob:query']]));
    const resolveFragment = buildHrefResolver(new Map([['Images/a%23b.jpg', 'blob:fragment']]));

    expect(resolveQuery('Images/a?b.jpg')).toBeUndefined();
    expect(resolveFragment('Images/a#b.jpg')).toBeUndefined();
  });
});
