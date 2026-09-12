import { describe, expect, it, vi } from 'vitest';
import { createInProcessBrowserReaderSession } from '../../src/bindings/browser/reader/worker-client';
import type { BrowserReaderBindingModule } from '../../src/bindings/browser/reader/types';

describe('Browser reader in-process client', () => {
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
    ratio: 1,
    commandCount: 0,
    commandCounts: {},
    primitiveCount: 0,
    byteLength: 23,
    commandHash: 'hash',
    resourceRefCount: 0,
    resourceTable: [],
    fontFamilies: [],
    imageDominated: false,
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
    pinnedFontPolicy: vi.fn(() => emptyPinnedFontPolicy()),
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

function emptyPinnedFontPolicy() {
  return { schemaVersion: 1 as const, policyId: '01'.repeat(32), faces: [] };
}
