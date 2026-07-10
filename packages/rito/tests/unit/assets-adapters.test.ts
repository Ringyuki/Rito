import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createImageAssetResolver,
  createLazyImageLoaderWithDecoder,
  collectPageImageSources,
  collectSpreadImageSources,
  loadFontsWithRegistry,
  loadImagesWithDecoder,
  type FontRegistry,
  type ImageDecoder,
  type ImageDimensions,
} from '../../src/reference/ts-core/render/assets';
import { createWebFontRegistry } from '../../src/reference/ts-core/render/assets/web';
import type { Page, Spread } from '../../src/reference/ts-core/layout/core/types';
import type { EpubDocument } from '../../src/reference/ts-core/runtime/types';

interface TestImage extends ImageDimensions {
  readonly id: string;
}

function makeDoc(options?: {
  readonly stylesheets?: ReadonlyMap<string, string>;
  readonly fonts?: ReadonlyMap<string, Uint8Array>;
  readonly images?: ReadonlyMap<string, Uint8Array>;
}): EpubDocument {
  return {
    packageDocument: {
      metadata: { title: 'Test', language: 'en', identifier: 'test' },
      manifest: [],
      spine: [],
    },
    readChapter: () => undefined,
    stylesheets: options?.stylesheets ?? new Map<string, string>(),
    fonts: options?.fonts ?? new Map<string, Uint8Array>(),
    images: options?.images ?? new Map<string, Uint8Array>(),
    toc: [],
    close: () => undefined,
  };
}

describe('asset adapters', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('loads @font-face resources through an injected FontRegistry', async () => {
    const fontBytes = new Uint8Array([1, 2, 3]);
    const doc = makeDoc({
      stylesheets: new Map([
        [
          'style.css',
          '@font-face { font-family: "Book Font"; src: url("../Fonts/book.otf"); font-weight: 700; font-style: italic; }',
        ],
      ]),
      fonts: new Map([['Fonts/book.otf', fontBytes]]),
    });
    const loaded: Parameters<FontRegistry['loadFont']>[0][] = [];
    const registry: FontRegistry = {
      loadFont(resource) {
        loaded.push(resource);
        return Promise.resolve();
      },
    };

    await loadFontsWithRegistry(doc, registry);

    expect(loaded).toEqual([
      {
        family: 'Book Font',
        src: '../Fonts/book.otf',
        bytes: fontBytes,
        weight: '700',
        style: 'italic',
      },
    ]);
  });

  it('decodes images through an injected ImageDecoder', async () => {
    const coverBytes = new Uint8Array([10, 20]);
    const doc = makeDoc({ images: new Map([['Images/cover.png', coverBytes]]) });
    const decoded: string[] = [];
    const decoder: ImageDecoder<TestImage> = {
      decode(resource) {
        decoded.push(resource.href);
        return Promise.resolve({
          id: resource.href,
          width: resource.bytes[0] ?? 0,
          height: resource.bytes[1] ?? 0,
        });
      },
      dispose: () => undefined,
    };

    const images = await loadImagesWithDecoder(doc, decoder);

    expect(decoded).toEqual(['Images/cover.png']);
    expect(images.get('Images/cover.png')).toEqual({
      id: 'Images/cover.png',
      width: 10,
      height: 20,
    });
  });

  it('limits concurrent eager image decodes', async () => {
    const doc = makeDoc({
      images: new Map(
        Array.from({ length: 6 }, (_, index) => [`${String(index)}.png`, new Uint8Array([index])]),
      ),
    });
    let active = 0;
    let maxActive = 0;
    const decoder: ImageDecoder<TestImage> = {
      async decode(resource) {
        active += 1;
        maxActive = Math.max(maxActive, active);
        await Promise.resolve();
        active -= 1;
        return { id: resource.href, width: 1, height: 1 };
      },
      dispose: () => undefined,
    };

    await loadImagesWithDecoder(doc, decoder, undefined, { maxConcurrency: 2 });

    expect(maxActive).toBe(2);
  });

  it('rejects invalid eager image concurrency', async () => {
    const decoder: ImageDecoder<TestImage> = {
      decode: () => Promise.resolve({ id: 'unused', width: 1, height: 1 }),
      dispose: () => undefined,
    };

    await expect(
      loadImagesWithDecoder(makeDoc(), decoder, undefined, { maxConcurrency: 0 }),
    ).rejects.toThrow('maxConcurrency must be a positive integer');
  });

  it('resolves images without exposing map lookups to render callers', () => {
    const cover = { id: 'cover', width: 100, height: 150 };
    const resolver = createImageAssetResolver(new Map([['OPS/Images/cover.png', cover]]));

    expect(resolver.resolveImage('../Images/cover.png')).toBe(cover);
    expect(resolver.resolveImage('missing.png')).toBeUndefined();
  });

  it('evicts lazy images through the injected decoder disposer', async () => {
    const disposed: string[] = [];
    const decoder: ImageDecoder<TestImage> = {
      decode(resource) {
        return Promise.resolve({ id: resource.href, width: 1, height: 1 });
      },
      dispose(image) {
        disposed.push(image.id);
      },
    };
    const loader = createLazyImageLoaderWithDecoder(
      new Map([
        ['a.png', new Uint8Array([1])],
        ['b.png', new Uint8Array([2])],
      ]),
      decoder,
      1,
    );

    await loader.get('a.png');
    await loader.get('b.png');

    expect(loader.getCached('a.png')).toBeUndefined();
    expect(loader.getCached('b.png')?.id).toBe('b.png');
    expect(loader.resolveImage('b.png')?.id).toBe('b.png');
    expect(disposed).toEqual(['a.png']);
  });

  it('deduplicates concurrent lazy image requests', async () => {
    let decodeCount = 0;
    let resolveDecode: ((image: TestImage) => void) | undefined;
    const decoder: ImageDecoder<TestImage> = {
      decode() {
        decodeCount += 1;
        return new Promise((resolve) => {
          resolveDecode = resolve;
        });
      },
      dispose: () => undefined,
    };
    const loader = createLazyImageLoaderWithDecoder(
      new Map([['a.png', new Uint8Array([1])]]),
      decoder,
    );

    const first = loader.get('Images/a.png');
    const second = loader.get('../Images/a.png');
    resolveDecode?.({ id: 'a.png', width: 1, height: 1 });

    const [firstImage, secondImage] = await Promise.all([first, second]);
    expect(decodeCount).toBe(1);
    expect(firstImage).toBe(secondImage);
  });

  it('disposes a lazy image that finishes decoding after loader disposal', async () => {
    const disposed: string[] = [];
    let resolveDecode: ((image: TestImage) => void) | undefined;
    const decoder: ImageDecoder<TestImage> = {
      decode() {
        return new Promise((resolve) => {
          resolveDecode = resolve;
        });
      },
      dispose(image) {
        disposed.push(image.id);
      },
    };
    const loader = createLazyImageLoaderWithDecoder(
      new Map([['Images/a.png', new Uint8Array([1])]]),
      decoder,
    );

    const request = loader.get('a.png');
    loader.dispose();
    resolveDecode?.({ id: 'a.png', width: 1, height: 1 });

    await expect(request).resolves.toBeUndefined();
    expect(disposed).toEqual(['a.png']);
  });

  it('removes Web fonts registered by its registry on disposal', async () => {
    const created: FakeFontFace[] = [];
    class FakeFontFace {
      constructor() {
        created.push(this);
      }

      load(): Promise<FakeFontFace> {
        return Promise.resolve(this);
      }
    }
    const add = vi.fn();
    const remove = vi.fn(() => true);
    vi.stubGlobal('FontFace', FakeFontFace);
    const registry = createWebFontRegistry({ add, delete: remove } as unknown as FontFaceSet);

    await registry.loadFont({
      family: 'Book Font',
      src: 'book.woff2',
      bytes: new Uint8Array([1, 2, 3]),
    });
    registry.dispose?.();
    registry.dispose?.();

    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(created[0]);
  });

  it('collects spread image sources for lazy preloading', () => {
    const nestedBlock = block([{ type: 'image', src: 'nested.png', bounds: rect() }]);
    const page: Page = {
      index: 0,
      bounds: rect(100, 120),
      content: [
        block(
          [
            { type: 'image', src: 'block.png', bounds: rect() },
            {
              type: 'line-box',
              bounds: rect(),
              runs: [
                { type: 'inline-atom', bounds: rect(), imageSrc: 'inline.png' },
                { type: 'inline-atom', bounds: rect(), block: nestedBlock },
              ],
            },
          ],
          'background.png',
        ),
      ],
    };
    const spread: Spread = { index: 0, left: page };

    expect(collectPageImageSources(page)).toEqual([
      'background.png',
      'block.png',
      'inline.png',
      'nested.png',
    ]);
    expect(collectSpreadImageSources(spread)).toEqual([
      'background.png',
      'block.png',
      'inline.png',
      'nested.png',
    ]);
  });
});

function rect(width = 1, height = 1) {
  return { x: 0, y: 0, width, height };
}

function block(children: Page['content'][number]['children'], backgroundImage?: string) {
  return {
    type: 'layout-block' as const,
    bounds: rect(),
    children,
    ...(backgroundImage ? { paint: { background: { image: backgroundImage } } } : {}),
  };
}
