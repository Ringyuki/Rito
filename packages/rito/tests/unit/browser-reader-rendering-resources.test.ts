import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  preloadCurrentReaderFonts,
  preloadReaderFonts,
} from '../../src/bindings/browser/resources';
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
        revision: {
          workerSessionId: worker.sessionId,
          revisionId: 'preview',
          revisionVersion: 0,
        },
        baseCommitGeneration: 1,
        interactionPolicy: 'disabled',
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

  it('skips browser font registration when FontFace exists without a document', async () => {
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('fonts', undefined);
    const readResource = vi.fn();
    const state = createState({
      worker: { ...createWorker(), readResource } as unknown as BrowserReaderWorkerClient,
      publication: {
        fontFaces: [{ family: 'BookFont', href: 'fonts/book.woff2' }],
        resources: { fonts: [], images: [], stylesheets: [] },
      },
    });

    await expect(preloadReaderFonts(state)).resolves.toBe(false);

    expect(readResource).not.toHaveBeenCalled();
    expect(state.registeredFontFaces.size).toBe(0);
  });

  it('registers publication fonts through a worker-global font set', async () => {
    const addFont = vi.fn();
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', undefined);
    vi.stubGlobal('fonts', { add: addFont, delete: vi.fn() });
    const state = createState({
      publication: {
        fontFaces: [{ family: 'WorkerFont', href: 'fonts/worker.woff2' }],
        resources: { fonts: [], images: [], stylesheets: [] },
      },
    });

    await preloadReaderFonts(state);

    expect(addFont).toHaveBeenCalledOnce();
    expect(state.registeredFontFaces.size).toBe(1);
  });

  it('skips a publication FontFace that collides with a canonical pinned alias', async () => {
    const alias = `__RitoPinned_${'a'.repeat(64)}`;
    const caseVariant = alias.replace('RitoPinned', 'RITOPINNED');
    const addFont = vi.fn();
    const readResource = vi.fn();
    vi.stubGlobal('FontFace', FakeFontFace);
    vi.stubGlobal('document', { fonts: { add: addFont } });
    const pinnedFace = new FakeFontFace(alias, new ArrayBuffer(1)) as unknown as FontFace;
    const state = createState({
      worker: { ...createWorker(), readResource } as unknown as BrowserReaderWorkerClient,
      pinnedFonts: {
        policy: undefined,
        summary: emptyPinnedFontPolicySummary(),
        registry: undefined,
        faces: new Map([[alias, pinnedFace]]),
      },
      publication: {
        fontFaces: [{ family: caseVariant, href: 'fonts/collision.woff2' }],
        resources: { fonts: [], images: [], stylesheets: [] },
      },
    });

    await preloadReaderFonts(state);

    expect(readResource).not.toHaveBeenCalled();
    expect(addFont).not.toHaveBeenCalled();
    expect(state.registeredFontFaces.size).toBe(0);
  });

  it('retries font registration when the active revision changes during a slow load', async () => {
    const addFont = vi.fn();
    const finishLoads: Array<() => void> = [];
    class DeferredFontFace extends FakeFontFace {
      override load(): Promise<DeferredFontFace> {
        return new Promise((resolve) => {
          finishLoads.push(() => {
            resolve(this);
          });
        });
      }
    }
    vi.stubGlobal('FontFace', DeferredFontFace);
    vi.stubGlobal('document', { fonts: { add: addFont } });
    const readResource = vi.fn((revisionId: string) =>
      Promise.resolve({
        payload: {
          revisionId,
          transferId: `transfer-${revisionId}`,
          kind: 'font' as const,
          href: 'fonts/book.woff2',
          mediaType: 'font/woff2',
          byteLength: 4,
        },
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    );
    const state = createState({
      worker: { ...createWorker(), readResource } as BrowserReaderWorkerClient,
      publication: {
        fontFaces: [{ family: 'BookFont', href: 'fonts/book.woff2' }],
        resources: { fonts: [], images: [], stylesheets: [] },
      },
    });

    const preload = preloadCurrentReaderFonts(state);
    await flushPromises();
    expect(readResource).toHaveBeenCalledWith('rev-1', 'font', 'fonts/book.woff2');
    expect(finishLoads).toHaveLength(1);

    state.revisionBundle = {
      ...state.revisionBundle,
      revision: { ...state.revisionBundle.revision, revisionId: 'rev-2' },
    };
    finishLoads[0]?.();
    await flushPromises();

    expect(readResource).toHaveBeenLastCalledWith('rev-2', 'font', 'fonts/book.woff2');
    expect(finishLoads).toHaveLength(2);
    expect(addFont).not.toHaveBeenCalled();

    finishLoads[1]?.();
    await preload;

    expect(addFont).toHaveBeenCalledOnce();
    expect(state.registeredFontFaces.size).toBe(1);
  });

  it('registers loaded fonts in metadata order when loads settle in reverse order', async () => {
    const addFont = vi.fn();
    const loadSettlements = new Map<
      string,
      { readonly resolve: () => void; readonly reject: () => void }
    >();
    class ControlledFontFace extends FakeFontFace {
      override load(): Promise<ControlledFontFace> {
        return new Promise((resolve, reject) => {
          loadSettlements.set(this.family, {
            resolve: () => {
              resolve(this);
            },
            reject: () => {
              reject(new Error(`failed to load ${this.family}`));
            },
          });
        });
      }
    }
    vi.stubGlobal('FontFace', ControlledFontFace);
    vi.stubGlobal('document', { fonts: { add: addFont } });
    const readResource = vi.fn((_revisionId: string, _kind: string, href: string) =>
      Promise.resolve({
        payload: {
          revisionId: 'rev-1',
          transferId: `transfer-${href}`,
          kind: 'font' as const,
          href,
          mediaType: 'font/woff2',
          byteLength: 4,
        },
        bytes: new Uint8Array([1, 2, 3, 4]),
      }),
    );
    const state = createState({
      worker: { ...createWorker(), readResource } as BrowserReaderWorkerClient,
      publication: {
        fontFaces: [
          { family: 'First', href: 'fonts/first.woff2' },
          { family: 'Broken', href: 'fonts/broken.woff2' },
          { family: 'Second', href: 'fonts/second.woff2' },
        ],
        resources: { fonts: [], images: [], stylesheets: [] },
      },
    });

    const preload = preloadReaderFonts(state);
    await flushPromises();
    expect(readResource.mock.calls.map((call) => call[2])).toEqual([
      'fonts/first.woff2',
      'fonts/broken.woff2',
      'fonts/second.woff2',
    ]);
    expect([...loadSettlements.keys()]).toEqual(['First', 'Broken', 'Second']);

    const secondLoad = expectDefined(loadSettlements.get('Second'));
    const brokenLoad = expectDefined(loadSettlements.get('Broken'));
    secondLoad.resolve();
    brokenLoad.reject();
    await flushPromises();
    expect(addFont).not.toHaveBeenCalled();

    const firstLoad = expectDefined(loadSettlements.get('First'));
    firstLoad.resolve();
    await preload;

    expect(addFont.mock.calls.map((call) => (call[0] as ControlledFontFace).family)).toEqual([
      'First',
      'Second',
    ]);
    expect([...state.registeredFontFaces.values()].map((face) => face.family)).toEqual([
      'First',
      'Second',
    ]);
  });

  it('does not register a font prepared for a stale revision', async () => {
    const addFont = vi.fn();
    let finishLoad: (() => void) | undefined;
    class DeferredFontFace extends FakeFontFace {
      override load(): Promise<DeferredFontFace> {
        return new Promise((resolve) => {
          finishLoad = () => {
            resolve(this);
          };
        });
      }
    }
    vi.stubGlobal('FontFace', DeferredFontFace);
    vi.stubGlobal('document', { fonts: { add: addFont } });
    const state = createState({
      publication: {
        fontFaces: [{ family: 'BookFont', href: 'fonts/book.woff2' }],
        resources: { fonts: [], images: [], stylesheets: [] },
      },
    });

    const preload = preloadReaderFonts(state);
    await flushPromises();
    state.revisionBundle = {
      ...state.revisionBundle,
      revision: { ...state.revisionBundle.revision, revisionId: 'rev-2' },
    };
    expectDefined(finishLoad)();
    await preload;

    expect(addFont).not.toHaveBeenCalled();
    expect(state.registeredFontFaces.size).toBe(0);
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
      revision: {
        revisionId: 'rev-1',
        revisionVersion: 0,
        layoutKey: 'layout',
        status: 'complete',
        knownExtent: { pageCount: 1, spreadCount: 3 },
        finalExtent: { pageCount: 1, spreadCount: 3 },
        pageCount: 1,
        spreadCount: 3,
      },
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
    revisionHandle: {
      workerSessionId: 'rendering-resource-session',
      revisionId: 'rev-1',
      revisionVersion: 0,
      commitGeneration: 1,
    },
    commitGeneration: 1,
    frames: new Map(),
    pendingFrameLoads: new Map(),
    images: new Map(),
    pendingImageLoads: new Map(),
    registeredFontFaces: new Map(),
    pinnedFonts: {
      policy: undefined,
      summary: emptyPinnedFontPolicySummary(),
      registry: undefined,
      faces: new Map(),
    },
    ctx: fontMetricContext(),
    fontMetrics: {
      genericSerif: { advances: {}, pairAdjustments: {} },
      fontFamilies: {},
    },
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

function emptyPinnedFontPolicySummary() {
  return { schemaVersion: 1 as const, policyId: '0'.repeat(64), faces: [] };
}

function fontMetricContext(): BrowserReaderState['ctx'] {
  return {
    font: '',
    wordSpacing: '',
    letterSpacing: '',
    save() {},
    restore() {},
    measureText(text: string) {
      return { width: Array.from(text).length * 16 } as TextMetrics;
    },
  } as BrowserReaderState['ctx'];
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
    sessionId: 'rendering-resource-session',
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

function expectDefined<T>(value: T | undefined): T {
  expect(value).toBeDefined();
  if (value === undefined) throw new Error('expected value to be defined');
  return value;
}

async function flushPromises(): Promise<void> {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}
