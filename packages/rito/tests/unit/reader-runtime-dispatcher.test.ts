import { describe, expect, it } from 'vitest';
import type { ImageDimensions } from '../../src/layout/core/types';
import type { EpubDocument } from '../../src/runtime/types';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  createReaderRuntimeDispatcher,
  type ReaderRuntimeCommand,
  type ReaderRuntimeOperationEvent,
  type StoreReaderResourceTransferInput,
} from '../../src/runtime/reader-session';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import {
  LAYOUT,
  baseDeps,
  expectSerializable,
  makeDocument,
  makePage,
  openCommand,
  paginationResult,
} from './reader-runtime-dispatcher-test-utils';

describe('createReaderRuntimeDispatcher', () => {
  it('opens a session and dispatches revision-scoped commands', async () => {
    const transfers: StoreReaderResourceTransferInput[] = [];
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        storeResourceTransfer(input) {
          transfers.push(input);
          return 'transfer-cover';
        },
      }),
    );

    const open = await dispatcher.handleCommand(openCommand());
    const revision = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'revision-1',
      kind: 'createRevision',
      sessionId: 'session-1',
      payload: LAYOUT,
    });
    const frame = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'frame-1',
      kind: 'getSpreadFrame',
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: { spreadIndex: 1 },
    });
    const resolved = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'locator-1',
      kind: 'resolveLocator',
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: {
        locator: { href: 'page:1', mediaType: 'application/xhtml+xml', progression: 0 },
      },
    });
    const resource = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'resource-1',
      kind: 'getResource',
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: {
        resource: {
          id: 'cover',
          kind: 'image',
          href: 'Images/cover.png',
          mediaType: 'image/png',
        },
      },
    });

    for (const response of [open, revision, frame, resolved, resource]) {
      expect(response).toMatchObject({ protocolVersion: READER_RUNTIME_PROTOCOL_VERSION });
      expectSerializable(response);
    }
    expect(open).toMatchObject({
      kind: 'openSession',
      ok: true,
      requestId: 'open-1',
      sessionId: 'session-1',
      payload: { publication: { metadata: { title: 'Book' }, spineItemCount: 1 } },
    });
    expect(revision).toMatchObject({ kind: 'createRevision', ok: true, revisionId: 'rev-1' });
    expect(frame).toMatchObject({
      kind: 'getSpreadFrame',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: { frame: { spreadIndex: 1, pageIndexes: [1] } },
    });
    expect(resolved).toMatchObject({
      kind: 'resolveLocator',
      ok: true,
      payload: { revisionId: 'rev-1', pageIndex: 1, spreadIndex: 1 },
    });
    expect(resource).toMatchObject({
      kind: 'getResource',
      ok: true,
      revisionId: 'rev-1',
      payload: { byteLength: 1, transferId: 'transfer-cover' },
    });
    expect(transfers[0]).toMatchObject({
      sessionId: 'session-1',
      revisionId: 'rev-1',
      resource: { href: 'Images/cover.png' },
      bytes: new Uint8Array([7]),
      mediaType: 'image/png',
    });
  });

  it('runs injected font registration before dispatcher revision pagination', async () => {
    const calls: string[] = [];
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        registerFonts(input) {
          calls.push(`fonts:${input.sessionId}`);
        },
        paginateRevision: () => {
          calls.push('paginate');
          return paginationResult([makePage(0)]);
        },
      }),
    );

    await dispatcher.handleCommand(openCommand());
    const revision = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'revision-1',
      kind: 'createRevision',
      sessionId: 'session-1',
      payload: LAYOUT,
    });

    expect(revision).toMatchObject({
      kind: 'createRevision',
      ok: true,
      revisionId: 'rev-1',
    });
    expect(calls).toEqual(['fonts:session-1', 'paginate']);
  });

  it('emits operation telemetry for successful and failed commands', async () => {
    const events: ReaderRuntimeOperationEvent[] = [];
    let timestamp = 0;
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        onRuntimeEvent(event) {
          events.push(event);
        },
        now: () => {
          timestamp += 5;
          return timestamp;
        },
      }),
    );

    await dispatcher.handleCommand(openCommand('telemetry-open'));
    await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'telemetry-missing',
      kind: 'getSpreadFrame',
      sessionId: 'missing-session',
      revisionId: 'rev-1',
      payload: { spreadIndex: 0 },
    });

    expect(events).toEqual([
      {
        kind: 'operation',
        phase: 'start',
        operation: 'openSession',
        requestId: 'telemetry-open',
        timestamp: 5,
      },
      {
        kind: 'operation',
        phase: 'finish',
        operation: 'openSession',
        requestId: 'telemetry-open',
        sessionId: 'session-1',
        timestamp: 10,
        durationMs: 5,
        ok: true,
      },
      {
        kind: 'operation',
        phase: 'start',
        operation: 'getSpreadFrame',
        requestId: 'telemetry-missing',
        sessionId: 'missing-session',
        revisionId: 'rev-1',
        timestamp: 15,
      },
      {
        kind: 'operation',
        phase: 'finish',
        operation: 'getSpreadFrame',
        requestId: 'telemetry-missing',
        sessionId: 'missing-session',
        revisionId: 'rev-1',
        timestamp: 20,
        durationMs: 5,
        ok: false,
        errorCode: 'not-found',
      },
    ]);
  });

  it('prefetches and searches with revision-scoped envelopes', async () => {
    const dispatcher = createReaderRuntimeDispatcher(baseDeps());
    await dispatcher.handleCommand(openCommand());
    await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'revision-1',
      kind: 'createRevision',
      sessionId: 'session-1',
      payload: LAYOUT,
    });

    const prefetch = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'prefetch-1',
      kind: 'prefetch',
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: { spreadIndexes: [0] },
    });
    const search = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'search-1',
      kind: 'search',
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: { query: 'term' },
    });
    const geometry = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'geometry-1',
      kind: 'resolveLocatorGeometry',
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: {
        locator: { href: 'page:0', mediaType: 'application/xhtml+xml', progression: 0 },
      },
    });
    const missingSpread = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'frame-missing',
      kind: 'getSpreadFrame',
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: { spreadIndex: 20 },
    });

    expect(prefetch).toMatchObject({
      kind: 'prefetch',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: { spreadIndexes: [0] },
    });
    expect(search).toMatchObject({
      kind: 'search',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: {
        results: [],
        hasMore: false,
      },
    });
    expect(geometry).toMatchObject({
      kind: 'error',
      ok: false,
      sessionId: 'session-1',
      revisionId: 'rev-1',
      error: { code: 'not-supported' },
    });
    expect(missingSpread).toMatchObject({
      kind: 'error',
      ok: false,
      revisionId: 'rev-1',
      error: { code: 'not-found' },
    });
  });

  it('gets footnotes through revision-scoped envelopes', async () => {
    const footnote = {
      kind: 'footnote' as const,
      text: 'Footnote text',
      html: '<p>Footnote text</p>',
    };
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        paginateRevision: () => ({
          pages: [makePage(0)],
          chapterMap: new Map([['ch1', { startPage: 0, endPage: 0 }]]),
          anchorMap: new Map<string, never>(),
          chapterTextIndices: new Map<string, never>(),
          footnoteMap: new Map([['ch1.xhtml#fn1', footnote]]),
        }),
      }),
    );
    await dispatcher.handleCommand(openCommand());
    await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'revision-1',
      kind: 'createRevision',
      sessionId: 'session-1',
      payload: LAYOUT,
    });

    const response = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'footnote-1',
      kind: 'getFootnote',
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: { ref: { href: 'ch1.xhtml#fn1' } },
    });

    expect(response).toMatchObject({
      kind: 'getFootnote',
      ok: true,
      sessionId: 'session-1',
      revisionId: 'rev-1',
      payload: {
        ref: { href: 'ch1.xhtml#fn1' },
        footnote,
      },
    });
    expectSerializable(response);
  });

  it('rejects unknown sessions and bad protocol versions', async () => {
    const dispatcher = createReaderRuntimeDispatcher(baseDeps());

    const unknown = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'unknown-1',
      kind: 'getSpreadFrame',
      sessionId: 'missing-session',
      revisionId: 'rev-1',
      payload: { spreadIndex: 0 },
    });
    const badVersion = await dispatcher.handleCommand({
      protocolVersion: 999,
      requestId: 'bad-version',
      kind: 'openSession',
      payload: { publicationRef: 'book.epub' },
    } as unknown as ReaderRuntimeCommand);

    expect(unknown).toMatchObject({
      kind: 'error',
      ok: false,
      sessionId: 'missing-session',
      revisionId: 'rev-1',
      error: { code: 'not-found' },
    });
    expect(badVersion).toMatchObject({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'bad-version',
      kind: 'error',
      ok: false,
      error: { code: 'bad-request' },
    });
    expectSerializable(unknown);
    expectSerializable(badVersion);
  });

  it('closes sessions and rejects later commands for that session', async () => {
    let closed = 0;
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        openPublication: () => Promise.resolve(makeDocument({ onClose: () => closed++ })),
      }),
    );
    await dispatcher.handleCommand(openCommand());

    const close = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'close-1',
      kind: 'closeSession',
      sessionId: 'session-1',
    });
    const afterClose = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'revision-after-close',
      kind: 'createRevision',
      sessionId: 'session-1',
      payload: LAYOUT,
    });

    expect(close).toMatchObject({
      kind: 'closeSession',
      ok: true,
      sessionId: 'session-1',
      payload: { closed: true },
    });
    expect(closed).toBe(1);
    expect(afterClose).toMatchObject({
      kind: 'error',
      ok: false,
      sessionId: 'session-1',
      error: { code: 'not-found' },
    });
  });

  it('returns structured errors when closeSession disposal throws', async () => {
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        openPublication: () =>
          Promise.resolve(
            makeDocument({
              onClose: () => {
                throw new Error('close failed');
              },
            }),
          ),
      }),
    );
    await dispatcher.handleCommand(openCommand());

    const response = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'close-throws',
      kind: 'closeSession',
      sessionId: 'session-1',
    });
    const afterClose = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'revision-after-close-throws',
      kind: 'createRevision',
      sessionId: 'session-1',
      payload: LAYOUT,
    });

    expect(response).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'close-throws',
      sessionId: 'session-1',
      error: {
        code: 'internal-error',
        details: { cause: 'close failed' },
      },
    });
    expect(afterClose).toMatchObject({
      kind: 'error',
      ok: false,
      sessionId: 'session-1',
      error: { code: 'not-found' },
    });
    expectSerializable(response);
    expectSerializable(afterClose);
  });

  it('turns openPublication failures into structured errors without registering a session', async () => {
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        openPublication: () => Promise.reject(new Error('cannot read epub')),
      }),
    );

    const open = await dispatcher.handleCommand(openCommand());
    const close = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'close-after-failed-open',
      kind: 'closeSession',
      sessionId: 'session-1',
    });

    expect(open).toMatchObject({
      kind: 'error',
      ok: false,
      error: {
        code: 'internal-error',
        details: { cause: 'cannot read epub' },
      },
    });
    expect(close).toMatchObject({ kind: 'error', ok: false, error: { code: 'not-found' } });
  });

  it('keeps openSession cleanup failures from rejecting the dispatcher', async () => {
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        createTextMeasurer: () => {
          throw new Error('measurer unavailable');
        },
        openPublication: () =>
          Promise.resolve(
            makeDocument({
              onClose: () => {
                throw new Error('cleanup failed');
              },
            }),
          ),
      }),
    );

    const open = await dispatcher.handleCommand(openCommand());
    const close = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'close-after-cleanup-failure',
      kind: 'closeSession',
      sessionId: 'session-1',
    });

    expect(open).toMatchObject({
      kind: 'error',
      ok: false,
      error: {
        code: 'internal-error',
        details: { cause: 'measurer unavailable' },
      },
    });
    expect(close).toMatchObject({ kind: 'error', ok: false, error: { code: 'not-found' } });
  });

  it('rejects in-flight openSession when dispatcher is disposed during publication open', async () => {
    let closed = 0;
    let resolveOpenStarted = (): void => {
      throw new Error('openPublication was not started');
    };
    let resolveDocument = (_document: EpubDocument): void => {
      throw new Error('publication was not requested');
    };
    const openStarted = new Promise<void>((resolve) => {
      resolveOpenStarted = resolve;
    });
    const publication = new Promise<EpubDocument>((resolve) => {
      resolveDocument = resolve;
    });
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        openPublication: () => {
          resolveOpenStarted();
          return publication;
        },
      }),
    );

    const open = dispatcher.handleCommand(openCommand('open-disposed-during-publication'));
    await openStarted;
    dispatcher.dispose();
    resolveDocument(makeDocument({ onClose: () => closed++ }));
    const response = await open;

    expect(response).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'open-disposed-during-publication',
      error: { code: 'bad-request' },
    });
    expect(response).not.toHaveProperty('sessionId');
    expect(closed).toBe(1);
    expectSerializable(response);
  });

  it('rejects in-flight openSession when dispatcher is disposed before registration', async () => {
    let closed = 0;
    let resolveLoadStarted = (): void => {
      throw new Error('loadImageDimensions was not started');
    };
    let resolveImages = (_images: ReadonlyMap<string, ImageDimensions>): void => {
      throw new Error('image dimensions were not requested');
    };
    const loadStarted = new Promise<void>((resolve) => {
      resolveLoadStarted = resolve;
    });
    const imageDimensions = new Promise<ReadonlyMap<string, ImageDimensions>>((resolve) => {
      resolveImages = resolve;
    });
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        openPublication: () => Promise.resolve(makeDocument({ onClose: () => closed++ })),
        loadImageDimensions: () => {
          resolveLoadStarted();
          return imageDimensions;
        },
      }),
    );

    const open = dispatcher.handleCommand(openCommand('open-disposed-during-load'));
    await loadStarted;
    dispatcher.dispose();
    resolveImages(new Map<string, ImageDimensions>());
    const response = await open;

    expect(response).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'open-disposed-during-load',
      error: { code: 'bad-request' },
    });
    expect(response).not.toHaveProperty('sessionId');
    expect(closed).toBe(1);
    expectSerializable(response);
  });

  it('rejects openSession when dispatcher is disposed during session creation', async () => {
    let closed = 0;
    let disposeRuntime = (): void => {
      throw new Error('dispatcher was not assigned');
    };
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        openPublication: () => Promise.resolve(makeDocument({ onClose: () => closed++ })),
        createTextMeasurer: () => {
          disposeRuntime();
          return createMockTextMeasurer();
        },
      }),
    );
    disposeRuntime = () => {
      dispatcher.dispose();
    };

    const response = await dispatcher.handleCommand(openCommand('open-disposed-during-create'));

    expect(response).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'open-disposed-during-create',
      error: { code: 'bad-request' },
    });
    expect(response).not.toHaveProperty('sessionId');
    expect(closed).toBe(1);
    expectSerializable(response);
  });

  it('reserves session ids so concurrent openSession cannot overwrite an existing id', async () => {
    let openCount = 0;
    let closed = 0;
    let resolveOpenStarted = (): void => {
      throw new Error('openPublication was not started');
    };
    let resolveDocument = (_document: EpubDocument): void => {
      throw new Error('publication was not requested');
    };
    const openStarted = new Promise<void>((resolve) => {
      resolveOpenStarted = resolve;
    });
    const publication = new Promise<EpubDocument>((resolve) => {
      resolveDocument = resolve;
    });
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        createSessionId: () => 'session-1',
        openPublication: () => {
          openCount++;
          resolveOpenStarted();
          return publication;
        },
      }),
    );

    const first = dispatcher.handleCommand(openCommand('open-1'));
    await openStarted;
    const second = await dispatcher.handleCommand(openCommand('open-2'));
    resolveDocument(makeDocument({ onClose: () => closed++ }));
    const firstResponse = await first;

    expect(firstResponse).toMatchObject({
      kind: 'openSession',
      ok: true,
      requestId: 'open-1',
      sessionId: 'session-1',
    });
    expect(second).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'open-2',
      sessionId: 'session-1',
      error: { code: 'internal-error' },
    });
    expect(openCount).toBe(1);
    expect(closed).toBe(0);
    dispatcher.dispose();
    expect(closed).toBe(1);
    expectSerializable(firstResponse);
    expectSerializable(second);
  });

  it('does not overwrite an existing session on session id collision', async () => {
    let openCount = 0;
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        createSessionId: () => 'session-1',
        openPublication: () => {
          openCount++;
          return Promise.resolve(makeDocument());
        },
      }),
    );

    const first = await dispatcher.handleCommand(openCommand('open-1'));
    const second = await dispatcher.handleCommand(openCommand('open-2'));
    const revision = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'revision-1',
      kind: 'createRevision',
      sessionId: 'session-1',
      payload: LAYOUT,
    });

    expect(first).toMatchObject({ kind: 'openSession', ok: true, sessionId: 'session-1' });
    expect(second).toMatchObject({
      kind: 'error',
      ok: false,
      sessionId: 'session-1',
      error: { code: 'internal-error' },
    });
    expect(openCount).toBe(1);
    expect(revision).toMatchObject({ kind: 'createRevision', ok: true, revisionId: 'rev-1' });
  });

  it('disposes all sessions and rejects commands after dispatcher disposal', async () => {
    let closed = 0;
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        openPublication: () => Promise.resolve(makeDocument({ onClose: () => closed++ })),
      }),
    );
    await dispatcher.handleCommand(openCommand());

    dispatcher.dispose();
    const response = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'after-dispose',
      kind: 'createRevision',
      sessionId: 'session-1',
      payload: LAYOUT,
    });

    expect(closed).toBe(1);
    expect(response).toMatchObject({
      kind: 'error',
      ok: false,
      error: { code: 'bad-request' },
    });
  });

  it('keeps disposing sessions when one document close throws', async () => {
    const sessionIds = ['session-1', 'session-2'] as const;
    let nextSessionId = 0;
    let firstClosed = 0;
    let secondClosed = 0;
    const dispatcher = createReaderRuntimeDispatcher(
      baseDeps({
        createSessionId: () => sessionIds[nextSessionId++] ?? 'session-extra',
        openPublication: () => {
          const openIndex = nextSessionId;
          return Promise.resolve(
            makeDocument({
              onClose: () => {
                if (openIndex === 1) {
                  firstClosed++;
                  throw new Error('first close failed');
                }
                secondClosed++;
              },
            }),
          );
        },
      }),
    );
    await dispatcher.handleCommand(openCommand('open-1'));
    await dispatcher.handleCommand(openCommand('open-2'));

    expect(() => {
      dispatcher.dispose();
    }).not.toThrow();
    const response = await dispatcher.handleCommand({
      protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
      requestId: 'after-dispose-failure',
      kind: 'createRevision',
      sessionId: 'session-2',
      payload: LAYOUT,
    });

    expect(firstClosed).toBe(1);
    expect(secondClosed).toBe(1);
    expect(response).toMatchObject({
      kind: 'error',
      ok: false,
      error: { code: 'bad-request' },
    });
  });
});
