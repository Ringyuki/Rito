import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SessionReaderHostFonts } from '../../src/bindings/browser/session-reader/host-fonts';

const SHA = 'ab'.repeat(32);
const BYTES = new Uint8Array([0, 1, 0, 0, 7, 7, 7, 7]).buffer;

class FakeFontFace {
  static created: FakeFontFace[] = [];
  // What a face reports until its descriptors are set.
  style = 'normal';
  weight = 'normal';

  constructor(
    readonly family: string,
    readonly source: unknown,
  ) {
    FakeFontFace.created.push(this);
  }

  load(): Promise<this> {
    return Promise.resolve(this);
  }
}

/** The reference an artifact lists a host face by: the face's own style and weight. */
function fontRef(weight: number, style = 'normal') {
  return {
    family: `__RitoPinned_${SHA}`,
    href: `rito-host-font:${SHA}`,
    style,
    weight,
    shapeFingerprint: 'shape',
    byteLength: BigInt(BYTES.byteLength),
  };
}

describe('host faces of a session reader', () => {
  let registered: Set<unknown>;

  beforeEach(() => {
    FakeFontFace.created = [];
    registered = new Set();
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('fonts', registered);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('registers a face under the weight and style the engine lists it with', async () => {
    const fonts = new SessionReaderHostFonts();
    fonts.add([{ bytes: BYTES, expectedSha256: SHA }]);

    const face = await fonts.resolve(fontRef(400));

    // A regular face is a face of weight 400 and nothing else: text that
    // asks for 700 gets the weight the browser synthesizes from it, as the
    // same text does in a page.
    expect(face?.weight).toBe('400');
    expect(face?.style).toBe('normal');
    expect(face?.family).toBe(`__RitoPinned_${SHA}`);
    expect([...registered]).toEqual([face]);
  });

  it('keeps the descriptors of a face that is bold or italic itself', async () => {
    const fonts = new SessionReaderHostFonts();
    fonts.add([{ bytes: BYTES, expectedSha256: SHA }]);

    const face = await fonts.resolve(fontRef(700, 'italic'));

    expect(face?.weight).toBe('700');
    expect(face?.style).toBe('italic');
  });

  it('decodes a face when it is added and registers it once', async () => {
    const fonts = new SessionReaderHostFonts();
    fonts.add([{ bytes: BYTES, expectedSha256: SHA }]);
    fonts.add([{ bytes: BYTES, expectedSha256: SHA.toUpperCase() }]);

    expect(FakeFontFace.created).toHaveLength(1);
    expect(registered.size).toBe(0);

    const first = fonts.resolve(fontRef(400));
    const second = fonts.resolve(fontRef(400));
    expect(second).toBe(first);
    await first;
    expect(FakeFontFace.created).toHaveLength(1);
    expect(registered.size).toBe(1);
  });

  it('answers only for the faces it holds and forgets one that is removed', async () => {
    const fonts = new SessionReaderHostFonts();
    fonts.add([{ bytes: BYTES, expectedSha256: SHA }]);

    expect(fonts.resolve({ ...fontRef(400), href: 'OEBPS/fonts/book.otf' })).toBeUndefined();
    expect(fonts.resolve({ ...fontRef(400), byteLength: 3n })).toBeUndefined();

    await fonts.resolve(fontRef(400));
    fonts.remove([SHA]);
    await Promise.resolve();
    await Promise.resolve();

    expect(registered.size).toBe(0);
    expect(fonts.resolve(fontRef(400))).toBeUndefined();
  });
});
