import { afterEach, describe, expect, it, vi } from 'vitest';
import { createInProcessBrowserReaderSession } from '../../src/bindings/browser/reader/worker-client';
import type { CoreViewRevisionRequest } from '../../src/bindings/browser/core-contracts';
import type { BrowserReaderBindingModule } from '../../src/bindings/browser/reader/types';

describe('Browser reader in-process client', () => {
  afterEach(() => {
    delete readerWireGlobal().__RITO_CORE_WASM_READER_WIRE__;
  });

  it('rejects malformed locators the same way as the worker message path', async () => {
    const client = createInProcessBrowserReaderSession(bindingModule(documentRuntime()));

    await client.open(new ArrayBuffer(0));

    await expect(client.resolveLocator('rev-1', {})).rejects.toThrow(
      'Browser reader worker locator is missing href',
    );
  });

  it('returns planned frame resource bytes through one worker boundary call', async () => {
    const readerWorkerPayload = vi.fn(() => ({
      kind: 'warmFrameWindow',
      result: {
        plan: {
          revisionId: 'rev-1',
          centerSpreadIndex: 2,
          displaySpreadIndex: 2,
          spreadIndexes: [2, 3],
        },
        frames: [2, 3].map((spreadIndex) => ({
          metadata: frameMetadata(spreadIndex),
          bytes: new Uint8Array(),
        })),
        spreads: [2, 3].map((spreadIndex) => ({
          spreadIndex,
          resources: [
            {
              payload: {
                revisionId: 'rev-1',
                transferId: `transfer-${String(spreadIndex)}`,
                kind: 'image',
                href: `image-${String(spreadIndex)}.png`,
                mediaType: 'image/png',
                byteLength: 2,
              },
              bytes: new Uint8Array([1, 2]),
            },
          ],
        })),
      },
    }));
    const client = createInProcessBrowserReaderSession(
      bindingModule(documentRuntime({ readerWorkerPayload })),
    );

    await client.open(new ArrayBuffer(0));
    const result = await client.warmFrameWindow('rev-1', 2);

    expect(result.plan.spreadIndexes).toEqual([2, 3]);
    expect(result.frames.map((frame) => frame.metadata.spreadIndex)).toEqual([2, 3]);
    expect(result.spreads.map((spread) => spread.spreadIndex)).toEqual([2, 3]);
    expect(result.spreads[0]?.resources[0]?.payload.href).toBe('image-2.png');
    expect(result.spreads[1]?.resources[0]?.bytes).toEqual(new Uint8Array([1, 2]));
    expect(readerWorkerPayload).toHaveBeenCalledWith({
      id: 0,
      kind: 'warmFrameWindow',
      revisionId: 'rev-1',
      spreadIndex: 2,
    });
  });

  it('uses JSON view revision wire by default', async () => {
    const readerWorkerPayload = vi.fn(() => createViewRevisionPayload());
    const client = createInProcessBrowserReaderSession(
      bindingModule(documentRuntime({ readerWorkerPayload })),
    );

    await client.open(new ArrayBuffer(0));
    await client.createViewRevision(viewRevisionRequest());

    expect(readerWorkerPayload).toHaveBeenCalledWith({
      id: 0,
      kind: 'createViewRevision',
      request: viewRevisionRequest(),
      wire: 'json',
    });
  });

  it('uses RITORB1 view revision wire only behind the private switch', async () => {
    readerWireGlobal().__RITO_CORE_WASM_READER_WIRE__ = 'ritorb1';
    const readerWorkerPayload = vi.fn(() => createViewRevisionPayload());
    const client = createInProcessBrowserReaderSession(
      bindingModule(documentRuntime({ readerWorkerPayload })),
    );

    await client.open(new ArrayBuffer(0));
    await client.createViewRevision(viewRevisionRequest());

    expect(readerWorkerPayload).toHaveBeenCalledWith({
      id: 0,
      kind: 'createViewRevision',
      request: viewRevisionRequest(),
      wire: 'ritorb1',
    });
  });

  it('releases a complete revision through the in-process worker boundary', async () => {
    const readerWorkerPayload = vi.fn(() => ({ kind: 'releaseRevision' }));
    const client = createInProcessBrowserReaderSession(
      bindingModule(documentRuntime({ readerWorkerPayload })),
    );

    await client.open(new ArrayBuffer(0));
    await client.releaseRevision('rev-1');

    expect(readerWorkerPayload).toHaveBeenCalledWith({
      id: 0,
      kind: 'releaseRevision',
      revisionId: 'rev-1',
    });
  });
});

function frameMetadata(spreadIndex: number) {
  return {
    revisionId: 'rev-1',
    spreadIndex,
    width: 800,
    height: 600,
    protocolVersion: 2,
    commandCount: 0,
    commandCounts: {},
    recordStats: {
      geometryRecords: 0,
      paintRecords: 0,
      payloadRecords: 0,
      primaryStringRecords: 0,
      secondaryStringRecords: 0,
    },
    byteLength: 0,
    commandHash: 'hash',
    resourceRefCount: 0,
    resourceTable: [],
    fontFamilies: [],
    imageDominated: false,
    stringTable: [],
    payloadTable: [],
  };
}

function bindingModule(document: unknown): BrowserReaderBindingModule {
  return {
    decodeRitoFrameCommandBuffer: vi.fn(),
    normalizeRitoCoreWasmError: vi.fn(),
    initRitoCoreWasmEngine: vi.fn(() =>
      Promise.resolve({
        openDocument: vi.fn(() => document),
      }),
    ),
  } as unknown as BrowserReaderBindingModule;
}

function documentRuntime(overrides: Record<string, unknown> = {}): unknown {
  return {
    publication: vi.fn(() => ({
      package: {
        metadata: { title: '', language: '', identifier: '' },
        manifest: [],
        spine: [],
        toc: [],
      },
      resources: { images: [], fonts: [], stylesheets: [] },
      chapters: [],
      fontFaces: [],
    })),
    free: vi.fn(),
    resolveLocator: vi.fn(),
    readerWorkerPayload: vi.fn((request: { readonly kind: string; readonly locator?: unknown }) => {
      if (request.kind === 'resolveLocator')
        throw new Error('Browser reader worker locator is missing href');
      throw new Error(`Unhandled reader worker payload: ${request.kind}`);
    }),
    ...overrides,
  };
}

function viewRevisionRequest(): CoreViewRevisionRequest {
  return {
    layoutConfig: {
      viewportWidth: 800,
      viewportHeight: 600,
      pageWidth: 720,
      pageHeight: 520,
      marginTop: 40,
      marginRight: 40,
      marginBottom: 40,
      marginLeft: 40,
      spreadMode: 'single',
      firstPageAlone: false,
      spreadGap: 0,
      rootFontSize: 16,
      textMeasurement: 'fixtureCompatible',
    },
    activeSpreadIndex: 0,
    mode: 'preview',
  };
}

function createViewRevisionPayload(): unknown {
  return {
    kind: 'createViewRevision',
    result: {
      kind: 'preview',
      display: 'revision',
      result: {
        bundle: {
          revision: {
            revisionId: 'rev-1',
            revisionVersion: 0,
            layoutKey: 'layout',
            status: 'complete',
            knownExtent: { pageCount: 0, spreadCount: 0 },
            finalExtent: { pageCount: 0, spreadCount: 0 },
            pageCount: 0,
            spreadCount: 0,
          },
          navigation: {
            revisionId: 'rev-1',
            pageCount: 0,
            spreadCount: 0,
            spreads: [],
            chapters: [],
            chapterMap: {},
          },
          tocTargets: { revisionId: 'rev-1', targets: [] },
          footnotes: { revisionId: 'rev-1', entries: {} },
          chapterTextIndices: { revisionId: 'rev-1', entries: {} },
          fontFamilies: [],
        },
        preview: true,
      },
    },
  };
}

function readerWireGlobal(): typeof globalThis & {
  __RITO_CORE_WASM_READER_WIRE__?: 'json' | 'ritorb1';
} {
  return globalThis as typeof globalThis & {
    __RITO_CORE_WASM_READER_WIRE__?: 'json' | 'ritorb1';
  };
}
