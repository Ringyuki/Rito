import { afterEach, describe, expect, it, vi } from 'vitest';
import { preloadReaderFonts } from '../../src/bindings/browser/resources';
import { renderSpreadToContext } from '../../src/bindings/browser/rendering';
import { loadFrame } from '../../src/bindings/browser/reader/frame-cache';
import type { CanvasRenderingTarget } from '../../src/bindings/browser/frame-command-renderer';
import type {
  BrowserReaderFrame,
  BrowserReaderState,
} from '../../src/bindings/browser/reader/types';
import type { BrowserReaderWorkerClient } from '../../src/bindings/browser/core-contracts';
import { frameBuffer } from './browser-reader-reflow-state-fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Browser reader resource-backed rendering', () => {
  it('renders a current-spread visual preview without reading canonical frames', () => {
    const warmFrameWindow = vi.fn();
    const worker = createWorker(warmFrameWindow);
    const state = createState({
      worker,
      frames: new Map(),
      visualPreview: {
        revisionId: 'preview',
        spreadIndex: 2,
        frame: { ...frameWithImages(), revisionId: 'preview', spreadIndex: 2 },
        config: {
          viewportWidth: 320,
          viewportHeight: 480,
          pageWidth: 320,
          pageHeight: 480,
          marginTop: 0,
          marginRight: 0,
          marginBottom: 0,
          marginLeft: 0,
          spreadMode: 'single',
          firstPageAlone: true,
          spreadGap: 0,
          rootFontSize: 16,
        },
        spreadMode: 'single',
        lineBreaking: 'greedy',
        worker,
      },
    });
    const ctx = fakeCanvasContext();

    expect(renderSpreadToContext(state, 2, ctx)).toBe(true);
    expect(warmFrameWindow).not.toHaveBeenCalled();
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);
  });

  it('paints available frame content while image resources decode asynchronously', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(() => Promise.resolve(fakeImageBitmap())),
    );
    const invalidated: number[] = [];
    const state = createState({
      frames: new Map([[0, frameWithImages('cover.png')]]),
      spreadContentInvalidatedListeners: new Set([(index: number) => invalidated.push(index)]),
    });
    const ctx = fakeCanvasContext();

    expect(renderSpreadToContext(state, 0, ctx)).toBe(true);
    expect(ctx.clearRect).toHaveBeenCalledTimes(1);

    await flushPromises();
    expect(state.images.has('cover.png')).toBe(true);
    expect(invalidated).toEqual([0]);
  });

  it('draws a cached manifest bitmap referenced through an encoded EPUB-relative path', () => {
    const warmFrameWindow = vi.fn();
    const bitmap = fakeImageBitmap();
    const state = createState({
      worker: createWorker(warmFrameWindow),
      frames: new Map([[0, frameWithImages('../Images/My%20Pic.png')]]),
      images: new Map([['Images/My Pic.png', bitmap]]),
    });
    const ctx = fakeCanvasContext();

    expect(renderSpreadToContext(state, 0, ctx)).toBe(true);
    expect(warmFrameWindow).not.toHaveBeenCalled();
    expect(ctx.drawImage).toHaveBeenCalledWith(bitmap, 0, 0, 10, 10);
  });

  it('invalidates loaded frame buffers after publication fonts are registered', async () => {
    const addFont = vi.fn();
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: addFont } });
    const invalidated: number[] = [];
    const state = createState({
      frames: new Map([[2, frameWithImages()]]),
      publication: {
        fontFaces: [{ family: 'BookFont', href: 'fonts/book.woff2' }],
        resources: {
          fonts: [{ href: 'fonts/book.woff2', byteLength: 4, byteHash: 'font-hash' }],
          images: [],
          stylesheets: [],
        },
      },
    });
    state.spreadContentInvalidatedListeners = new Set([
      (index: number) => {
        invalidated.push(index);
        loadFrame(state, index);
      },
    ]);

    await preloadReaderFonts(state);

    expect(addFont).toHaveBeenCalledTimes(1);
    expect(state.registeredFontFaces.size).toBe(1);
    expect(state.registeredFontFaces.has('BookFont\u0000fonts/book.woff2\u0000\u0000')).toBe(true);
    expect(invalidated).toEqual([2]);
  });

  it('uses runtime frame font metadata for single-font fallback registration', async () => {
    const addFont = vi.fn();
    const warmFrameWindow = vi.fn();
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: addFont } });
    const state = createState({
      worker: createWorker(warmFrameWindow),
      publication: {
        chapters: [],
        fontFaces: [],
        resources: {
          fonts: [{ href: 'fonts/book.woff2', byteLength: 4, byteHash: 'font-hash' }],
          images: [],
          stylesheets: [],
        },
      },
    });
    state.revisionBundle = { ...state.revisionBundle, fontFamilies: ['BookFont'] };

    await preloadReaderFonts(state);

    expect(warmFrameWindow).not.toHaveBeenCalled();
    expect(addFont).toHaveBeenCalledTimes(1);
    expect((addFont.mock.calls[0]?.[0] as FakeFontFace | undefined)?.family).toBe('BookFont');
  });
});

class FakeFontFace {
  constructor(
    readonly family: string,
    readonly source: BufferSource,
    readonly descriptors?: FontFaceDescriptors,
  ) {}

  load(): Promise<FakeFontFace> {
    return Promise.resolve(this);
  }
}

function frameWithImages(...images: string[]): BrowserReaderFrame {
  return {
    revisionId: 'rev-1',
    spreadIndex: 0,
    width: 320,
    height: 480,
    commands: images.map((src) => ({
      kind: 'paintImage',
      src,
      rect: { x: 0, y: 0, width: 10, height: 10 },
    })),
    commandHash: 'hash',
    resourceRefs: { images },
    fontFamilies: [],
    imageDominated: images.length > 0,
  };
}

function createState(overrides: object = {}): BrowserReaderState {
  return {
    worker: createWorker(),
    revisionBundle: {
      revision: { revisionId: 'rev-1', layoutKey: 'layout', pageCount: 1, spreadCount: 3 },
      navigation: {
        revisionId: 'rev-1',
        pageCount: 1,
        spreadCount: 3,
        spreads: [],
        chapters: [],
        chapterMap: {},
      },
      tocTargets: { revisionId: 'rev-1', targets: [] },
      footnotes: { revisionId: 'rev-1', entries: {} },
      chapterTextIndices: { revisionId: 'rev-1', entries: {} },
      fontFamilies: [],
    },
    frames: new Map(),
    pendingFrameLoads: new Map(),
    images: new Map(),
    pendingImageLoads: new Map(),
    registeredFontFaces: new Map(),
    spreadContentInvalidatedListeners: new Set(),
    disposed: false,
    publication: {
      chapters: [],
      fontFaces: [],
      resources: { fonts: [], images: [], stylesheets: [] },
    },
    ...overrides,
  } as unknown as BrowserReaderState;
}

function createWorker(
  warmFrameWindow = vi.fn((_revisionId: string, centerSpreadIndex: number) =>
    Promise.resolve({
      plan: {
        revisionId: 'rev-1',
        centerSpreadIndex,
        displaySpreadIndex: centerSpreadIndex,
        spreadIndexes: [centerSpreadIndex],
      },
      frames: [frameBuffer('rev-1', centerSpreadIndex)],
      spreads: [
        {
          spreadIndex: centerSpreadIndex,
          resources: [
            {
              payload: {
                revisionId: 'rev-1',
                transferId: 'transfer-2',
                kind: 'image',
                href: 'cover.png',
                mediaType: 'image/png',
                byteLength: 4,
              },
              bytes: new Uint8Array([1, 2, 3, 4]),
            },
          ],
        },
      ],
    }),
  ),
): BrowserReaderWorkerClient {
  return {
    readResource: vi.fn(() =>
      Promise.resolve({
        payload: { mediaType: 'image/png', transferId: 'transfer-1', byteLength: 4 },
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    ),
    warmFrameWindow,
  } as unknown as BrowserReaderWorkerClient;
}

function fakeCanvasContext(): CanvasRenderingTarget & {
  readonly clearRect: ReturnType<typeof vi.fn>;
  readonly drawImage: ReturnType<typeof vi.fn>;
} {
  return {
    canvas: { width: 320, height: 480 },
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    save: vi.fn(),
    scale: vi.fn(),
    restore: vi.fn(),
  } as unknown as CanvasRenderingTarget & {
    readonly clearRect: ReturnType<typeof vi.fn>;
    readonly drawImage: ReturnType<typeof vi.fn>;
  };
}

function fakeImageBitmap(): ImageBitmap {
  return { close: vi.fn() } as unknown as ImageBitmap;
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
