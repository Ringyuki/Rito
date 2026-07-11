import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createReader } from '../../src/bindings/browser/reader/reader';

type InitialReflow =
  (typeof import('../../src/bindings/browser/reader/pipeline/reflow'))['startBrowserReaderInitialReflow'];

const mocks = vi.hoisted(() => ({
  buildBrowserReaderMethods: vi.fn(() => ({})),
  createBrowserReaderWorkerClientFactory: vi.fn(),
  loadRuntimeCoreModule: vi.fn(),
  preloadCurrentReaderFonts: vi.fn(),
  startBrowserReaderInitialReflow: vi.fn<InitialReflow>(() => Promise.resolve()),
  warmBrowserReaderFrameWindow: vi.fn(),
}));

vi.mock('../../src/bindings/browser/reader/reader-methods', () => ({
  buildBrowserReaderMethods: mocks.buildBrowserReaderMethods,
}));

vi.mock('../../src/bindings/browser/reader/worker-client', () => ({
  createBrowserReaderWorkerClientFactory: mocks.createBrowserReaderWorkerClientFactory,
}));

vi.mock('../../src/bindings/browser/reader/wasm-module', () => ({
  loadRuntimeCoreModule: mocks.loadRuntimeCoreModule,
}));

vi.mock('../../src/bindings/browser/reader/pipeline/reflow', () => ({
  startBrowserReaderInitialReflow: mocks.startBrowserReaderInitialReflow,
}));

vi.mock('../../src/bindings/browser/reader/frame-cache', () => ({
  warmBrowserReaderFrameWindow: mocks.warmBrowserReaderFrameWindow,
}));

vi.mock('../../src/bindings/browser/resources', () => ({
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
  });

  it('returns the visible reader without waiting for publication font registration', async () => {
    const fontRegistration = deferredVoid();
    const registrationStarted = deferredVoid();
    mocks.preloadCurrentReaderFonts.mockImplementation(() => {
      registrationStarted.resolve();
      return fontRegistration.promise;
    });
    mocks.startBrowserReaderInitialReflow.mockImplementation((...args) => {
      const beforeFullReflow = args[6];
      if (beforeFullReflow) void beforeFullReflow();
      return Promise.resolve();
    });
    const worker = {
      open: vi.fn(() => Promise.resolve({ publication: publicationWithFont() })),
      dispose: vi.fn(),
    };
    mocks.createBrowserReaderWorkerClientFactory.mockReturnValue(() => worker);
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
    expect(measureText).not.toHaveBeenCalled();
    expect(mocks.warmBrowserReaderFrameWindow).not.toHaveBeenCalled();

    fontRegistration.resolve();
    await flushPromises();

    expect(mocks.warmBrowserReaderFrameWindow).toHaveBeenCalledOnce();
  });

  it('preserves the primary creation error when worker cleanup fails', async () => {
    const primaryError = new Error('initial revision failed');
    mocks.startBrowserReaderInitialReflow.mockRejectedValue(primaryError);
    const worker = {
      open: vi.fn(() => Promise.resolve({ publication: publicationWithFont() })),
      dispose: vi.fn(() => {
        throw new Error('cleanup failed');
      }),
    };
    mocks.createBrowserReaderWorkerClientFactory.mockReturnValue(() => worker);

    await expect(
      createReader(new ArrayBuffer(0), readerCanvas(), { width: 800, height: 600 }),
    ).rejects.toBe(primaryError);
    expect(worker.dispose).toHaveBeenCalledOnce();
  });
});

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
