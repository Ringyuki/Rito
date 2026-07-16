import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createReader } from '../../src/bindings/browser/reader/reader';
import type { BrowserReaderWorkerOpenOptions } from '../../src/bindings/browser/core-contracts';

type InitialReflow =
  (typeof import('../../src/bindings/browser/reader/pipeline/bounded-reflow'))['startBrowserReaderInitialReflow'];

const mocks = vi.hoisted(() => ({
  buildBrowserReaderMethods: vi.fn(() => ({})),
  browserFontFaceRegistry: vi.fn(),
  createBrowserReaderResourceState: vi.fn(() => ({
    pendingImageLoads: new Map(),
    images: new Map(),
    registeredFontFaces: new Map(),
  })),
  createBrowserReaderWorkerClientFactory: vi.fn(),
  disposeBrowserReaderState: vi.fn(
    (state: {
      disposed: boolean;
      disposeTask: Promise<void> | undefined;
      workerFactory: { dispose?: (() => Promise<void>) | undefined };
      pinnedFonts: {
        registry: { delete(face: FontFace): boolean } | undefined;
        readonly faces: Map<string, FontFace>;
      };
    }) => {
      state.disposed = true;
      for (const face of state.pinnedFonts.faces.values()) {
        state.pinnedFonts.registry?.delete(face);
      }
      state.pinnedFonts.faces.clear();
      state.disposeTask = (state.workerFactory.dispose?.() ?? Promise.resolve()).catch(
        () => undefined,
      );
    },
  ),
  loadRuntimeCoreModule: vi.fn(),
  preloadCurrentReaderFonts: vi.fn(),
  startBrowserReaderInitialReflow: vi.fn<InitialReflow>(() => Promise.resolve()),
  warmBrowserReaderFrameWindow: vi.fn(),
}));

vi.mock('../../src/bindings/browser/reader/reader-methods', () => ({
  buildBrowserReaderMethods: mocks.buildBrowserReaderMethods,
}));

vi.mock('../../src/bindings/browser/reader/reader-dispose', () => ({
  disposeBrowserReaderState: mocks.disposeBrowserReaderState,
}));

vi.mock('../../src/bindings/browser/reader/worker-client', () => ({
  createBrowserReaderWorkerClientFactory: mocks.createBrowserReaderWorkerClientFactory,
}));

vi.mock('../../src/bindings/browser/reader/wasm-module', () => ({
  loadRuntimeCoreModule: mocks.loadRuntimeCoreModule,
}));

vi.mock('../../src/bindings/browser/reader/pipeline/bounded-reflow', () => ({
  scheduleBrowserReaderReflow: vi.fn(() => true),
  startBrowserReaderInitialReflow: mocks.startBrowserReaderInitialReflow,
}));

vi.mock('../../src/bindings/browser/reader/frame-cache', () => ({
  warmBrowserReaderFrameWindow: mocks.warmBrowserReaderFrameWindow,
}));

vi.mock('../../src/bindings/browser/resources', () => ({
  browserFontFaceRegistry: mocks.browserFontFaceRegistry,
  createBrowserReaderResourceState: mocks.createBrowserReaderResourceState,
  preloadCurrentReaderFonts: mocks.preloadCurrentReaderFonts,
}));

describe('Browser reader creation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.buildBrowserReaderMethods.mockReturnValue({});
    mocks.loadRuntimeCoreModule.mockResolvedValue({
      decodeRitoFrameCommandBuffer: vi.fn(),
      normalizeRitoCoreWasmError: vi.fn((error: unknown) =>
        error instanceof Error ? error : new Error(String(error)),
      ),
    });
    mocks.startBrowserReaderInitialReflow.mockResolvedValue();
    mocks.browserFontFaceRegistry.mockReturnValue(undefined);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the visible reader without waiting for publication font registration', async () => {
    const fontRegistration = deferredVoid();
    const registrationStarted = deferredVoid();
    mocks.preloadCurrentReaderFonts.mockImplementation(() => {
      registrationStarted.resolve();
      return fontRegistration.promise;
    });
    const worker = {
      open: vi.fn(() => Promise.resolve(openResultWithFont())),
      dispose: vi.fn(),
    };
    installWorkerFactory(worker);
    const measureText = vi.fn(() => ({ width: 16 }));
    const canvas = {
      getContext: vi.fn(() => ({
        save: vi.fn(),
        restore: vi.fn(),
        font: '',
        wordSpacing: '',
        letterSpacing: '',
        measureText,
      })),
    } as unknown as HTMLCanvasElement;

    const readerPromise = createReader(new ArrayBuffer(0), canvas, {
      width: 800,
      height: 600,
    });
    let settled = false;
    void readerPromise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    await registrationStarted.promise;
    await expect(readerPromise).resolves.toBeDefined();

    expect(settled).toBe(true);
    expect(mocks.buildBrowserReaderMethods).toHaveBeenCalledOnce();
    // Font metrics depend on the actual styles and sizes discovered by Rust,
    // so all probes remain behind the initial revision.
    expect(measureText).not.toHaveBeenCalled();
    expect(mocks.warmBrowserReaderFrameWindow).not.toHaveBeenCalled();

    fontRegistration.resolve();
    await flushPromises();

    expect(mocks.warmBrowserReaderFrameWindow).toHaveBeenCalledOnce();
  });

  it('awaits factory release while preserving the primary creation error', async () => {
    const primaryError = new Error('initial revision failed');
    mocks.startBrowserReaderInitialReflow.mockRejectedValue(primaryError);
    const cleanup = deferredVoid();
    const worker = {
      open: vi.fn(() => Promise.resolve(openResultWithFont())),
      dispose: vi.fn(() => {
        throw new Error('cleanup failed');
      }),
    };
    const factory = installWorkerFactory(worker, cleanup.promise);

    const creation = createReader(new ArrayBuffer(0), readerCanvas(), {
      width: 800,
      height: 600,
    });
    let settled = false;
    void creation.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );
    await waitForCall(factory.dispose);

    expect(factory.dispose).toHaveBeenCalledOnce();
    expect(worker.dispose).toHaveBeenCalledOnce();
    expect(settled).toBe(false);
    cleanup.resolve();

    await expect(creation).rejects.toBe(primaryError);
    expect(settled).toBe(true);
  });

  it('disposes a committed initial session when facade construction fails', async () => {
    const primaryError = new Error('reader facade failed');
    mocks.buildBrowserReaderMethods.mockImplementationOnce(() => {
      throw primaryError;
    });
    const worker = {
      open: vi.fn(() => Promise.resolve(openResultWithFont())),
      dispose: vi.fn(),
    };
    const factory = installWorkerFactory(worker);

    await expect(
      createReader(new ArrayBuffer(0), readerCanvas(), { width: 800, height: 600 }),
    ).rejects.toBe(primaryError);

    expect(factory.dispose).toHaveBeenCalledOnce();
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('loads and registers pinned faces before starting the initial reflow', async () => {
    let finishLoad: (() => void) | undefined;
    class DeferredFontFace {
      constructor(
        readonly family: string,
        readonly source: ArrayBuffer,
        readonly descriptors?: FontFaceDescriptors,
      ) {}

      load(): Promise<DeferredFontFace> {
        return new Promise((resolve) => {
          finishLoad = () => {
            resolve(this);
          };
        });
      }
    }
    vi.stubGlobal('FontFace', DeferredFontFace);
    const add = vi.fn();
    const remove = vi.fn(() => true);
    mocks.browserFontFaceRegistry.mockReturnValue({ add, delete: remove });
    const summary = pinnedFontPolicySummary();
    const worker = {
      open: vi.fn((_data: ArrayBuffer, _options?: BrowserReaderWorkerOpenOptions) =>
        Promise.resolve({ publication: publicationWithFont(), pinnedFontPolicy: summary }),
      ),
      dispose: vi.fn(),
    };
    installWorkerFactory(worker);
    const callerBytes = new Uint8Array([1, 2, 3]).buffer;

    const readerPromise = createReader(readerData(), readerCanvas(), {
      width: 800,
      height: 600,
      pinnedFontPolicy: {
        schemaVersion: 1,
        faces: [
          {
            bytes: callerBytes,
            expectedSha256: summary.faces[0]?.sha256 ?? '',
            genericRole: 'serif',
          },
        ],
      },
    });
    await flushPromises();

    expect(worker.open).toHaveBeenCalledOnce();
    expect(mocks.startBrowserReaderInitialReflow).not.toHaveBeenCalled();
    expect(add).not.toHaveBeenCalled();
    expect(finishLoad).toBeDefined();

    finishLoad?.();
    await expect(readerPromise).resolves.toBeDefined();

    expect(add).toHaveBeenCalledOnce();
    expect(mocks.startBrowserReaderInitialReflow).toHaveBeenCalledOnce();
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.startBrowserReaderInitialReflow.mock.invocationCallOrder[0] ?? 0,
    );
    const buildCalls = mocks.buildBrowserReaderMethods.mock.calls as unknown as readonly (readonly [
      unknown,
      unknown,
    ])[];
    expect(buildCalls[0]?.[1]).not.toHaveProperty('pinnedFontPolicy');
    const openOptions = worker.open.mock.calls[0]?.[1];
    const transferredBytes = openOptions?.pinnedFontPolicy?.faces[0]?.bytes;
    expect(transferredBytes).not.toBe(callerBytes);
    expect(new Uint8Array(transferredBytes ?? new ArrayBuffer(0))).toEqual(
      new Uint8Array(callerBytes),
    );
  });

  it('unregisters pinned faces when initial reflow fails', async () => {
    class LoadedFontFace {
      constructor(readonly family: string) {}
      load(): Promise<LoadedFontFace> {
        return Promise.resolve(this);
      }
    }
    vi.stubGlobal('FontFace', LoadedFontFace);
    const add = vi.fn();
    const remove = vi.fn(() => true);
    mocks.browserFontFaceRegistry.mockReturnValue({ add, delete: remove });
    const primaryError = new Error('initial pinned revision failed');
    mocks.startBrowserReaderInitialReflow.mockRejectedValue(primaryError);
    const summary = pinnedFontPolicySummary();
    const worker = {
      open: vi.fn((_data: ArrayBuffer, _options?: BrowserReaderWorkerOpenOptions) =>
        Promise.resolve({ publication: publicationWithFont(), pinnedFontPolicy: summary }),
      ),
      dispose: vi.fn(),
    };
    const factory = installWorkerFactory(worker);

    await expect(
      createReader(readerData(), readerCanvas(), {
        width: 800,
        height: 600,
        pinnedFontPolicy: {
          schemaVersion: 1,
          faces: [
            {
              bytes: new Uint8Array([1, 2, 3]).buffer,
              expectedSha256: summary.faces[0]?.sha256 ?? '',
              genericRole: 'serif',
            },
          ],
        },
      }),
    ).rejects.toBe(primaryError);

    expect(add).toHaveBeenCalledOnce();
    expect(remove).toHaveBeenCalledWith(add.mock.calls[0]?.[0]);
    expect(factory.dispose).toHaveBeenCalledOnce();
    expect(worker.dispose).toHaveBeenCalledOnce();
  });

  it('disposes the worker without registering faces when pinned open fails', async () => {
    class LoadedFontFace {
      constructor(readonly family: string) {}
      load(): Promise<LoadedFontFace> {
        return Promise.resolve(this);
      }
    }
    vi.stubGlobal('FontFace', LoadedFontFace);
    const add = vi.fn();
    mocks.browserFontFaceRegistry.mockReturnValue({ add, delete: vi.fn(() => true) });
    const openError = new Error('pinned worker open failed');
    const worker = {
      open: vi.fn((_data: ArrayBuffer, _options?: BrowserReaderWorkerOpenOptions) =>
        Promise.reject(openError),
      ),
      dispose: vi.fn(),
    };
    const factory = installWorkerFactory(worker);

    await expect(
      createReader(readerData(), readerCanvas(), {
        width: 800,
        height: 600,
        pinnedFontPolicy: {
          schemaVersion: 1,
          faces: [
            {
              bytes: new Uint8Array([1, 2, 3]).buffer,
              expectedSha256: 'a'.repeat(64),
              genericRole: 'serif',
            },
          ],
        },
      }),
    ).rejects.toBe(openError);

    expect(add).not.toHaveBeenCalled();
    expect(factory.dispose).toHaveBeenCalledOnce();
    expect(worker.dispose).toHaveBeenCalledOnce();
    expect(mocks.startBrowserReaderInitialReflow).not.toHaveBeenCalled();
  });
});

function installWorkerFactory(
  worker: { dispose(): void },
  completion: Promise<void> = Promise.resolve(),
): { readonly dispose: ReturnType<typeof vi.fn> } {
  const dispose = vi.fn(async () => {
    let failure: unknown;
    try {
      worker.dispose();
    } catch (error: unknown) {
      failure = error;
    }
    await completion;
    if (failure !== undefined) {
      throw failure instanceof Error ? failure : new Error('Worker disposal failed');
    }
  });
  mocks.createBrowserReaderWorkerClientFactory.mockReturnValue(
    Object.assign(() => worker, { dispose }),
  );
  return { dispose };
}

async function flushPromises(): Promise<void> {
  for (let attempt = 0; attempt < 8; attempt += 1) await Promise.resolve();
}

async function waitForCall(mock: ReturnType<typeof vi.fn>): Promise<void> {
  for (let attempt = 0; attempt < 32 && mock.mock.calls.length === 0; attempt += 1) {
    await Promise.resolve();
  }
  expect(mock).toHaveBeenCalledOnce();
}

function readerCanvas(): HTMLCanvasElement {
  return {
    getContext: vi.fn(() => ({
      save: vi.fn(),
      restore: vi.fn(),
      font: '',
      wordSpacing: '',
      letterSpacing: '',
      measureText: vi.fn(() => ({ width: 16 })),
    })),
  } as unknown as HTMLCanvasElement;
}

function readerData(): ArrayBuffer {
  return new Uint8Array([4, 5, 6]).buffer;
}

function deferredVoid(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve: (() => void) | undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return {
    promise,
    resolve: () => {
      if (!resolve) throw new Error('Deferred promise was not initialized');
      resolve();
    },
  };
}

function publicationWithFont() {
  return {
    package: {
      metadata: { title: 'Book', language: 'en', identifier: 'book' },
      manifest: [],
      spine: [],
      toc: [],
    },
    resources: {
      stylesheets: [],
      fonts: [{ href: 'fonts/book.woff2', byteLength: 4 }],
      images: [],
    },
    chapters: [],
    fontFaces: [{ family: 'BookFont', href: 'fonts/book.woff2' }],
  };
}

function openResultWithFont() {
  return {
    publication: publicationWithFont(),
    pinnedFontPolicy: { schemaVersion: 1 as const, policyId: '01'.repeat(32), faces: [] },
  };
}

function pinnedFontPolicySummary() {
  const sha256 = 'a'.repeat(64);
  return {
    schemaVersion: 1 as const,
    policyId: 'b'.repeat(64),
    faces: [
      {
        sha256,
        shapeFingerprint: sha256.slice(0, 16),
        familyAlias: `__RitoPinned_${sha256}`,
        byteLength: 3,
        genericRole: 'serif' as const,
        language: 'und',
        style: 'normal' as const,
        weight: 400 as const,
      },
    ],
  };
}
