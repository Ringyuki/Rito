import { describe, expect, it } from 'vitest';
import type { Page } from '../../src/layout/core/types';
import type { TextMeasurer } from '../../src/layout/text/text-measurer';
import type { EpubDocument, PaginationResult } from '../../src/runtime/types';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  createInProcessReaderRuntimeTransport,
  createReaderRuntimeClient,
  createReaderRuntimeDispatcher,
  type BuildReaderSessionFrame,
  type CreateReaderRuntimeDispatcherInput,
  type ReaderRuntimeCommand,
  type ReaderRuntimeRequestId,
  type ReaderRuntimeResponse,
  type ReaderSpreadFrame,
} from '../../src/runtime/reader-session';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

const LAYOUT = {
  viewport: { width: 400, height: 600 },
  spreadMode: 'single' as const,
  margin: 20,
};

const GEOMETRY_LOCATOR = {
  href: 'ch1.xhtml',
  mediaType: 'application/xhtml+xml',
  progression: 0,
  sourceRange: { start: 0, end: 4 },
};

function openCommand(requestId: ReaderRuntimeRequestId): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'openSession',
    payload: { publicationRef: 'book.epub' },
  };
}

function createRevisionCommand(requestId: ReaderRuntimeRequestId): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'createRevision',
    sessionId: 'session-1',
    payload: LAYOUT,
  };
}

function frameCommand(requestId: ReaderRuntimeRequestId): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'getSpreadFrame',
    sessionId: 'session-1',
    revisionId: 'revision-1',
    payload: { spreadIndex: 0 },
  };
}

function searchCommand(requestId: ReaderRuntimeRequestId): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'search',
    sessionId: 'session-1',
    revisionId: 'revision-1',
    payload: { query: 'chapter' },
  };
}

function geometryCommand(requestId: ReaderRuntimeRequestId): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'resolveLocatorGeometry',
    sessionId: 'session-1',
    revisionId: 'revision-1',
    payload: { locator: GEOMETRY_LOCATOR },
  };
}

function successResponse(command: ReaderRuntimeCommand): ReaderRuntimeResponse {
  switch (command.kind) {
    case 'openSession':
      return {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        kind: 'openSession',
        ok: true,
        sessionId: 'session-1',
        payload: {
          publication: {
            metadata: { title: 'Book', language: 'en', identifier: 'book-id' },
            spineItemCount: 1,
          },
        },
      };
    case 'createRevision':
      return {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        kind: 'createRevision',
        ok: true,
        sessionId: command.sessionId,
        revisionId: 'revision-1',
        payload: { revision: revision('revision-1') },
      };
    case 'getSpreadFrame':
      return {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        kind: 'getSpreadFrame',
        ok: true,
        sessionId: command.sessionId,
        revisionId: command.revisionId,
        payload: { frame: frame(command.revisionId) },
      };
    default:
      return {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        kind: 'error',
        ok: false,
        error: { code: 'not-supported', message: 'unsupported' },
      };
  }
}

function revision(id: string) {
  return {
    id,
    sessionId: 'session-1',
    layoutKey: `layout-${id}`,
    status: 'ready' as const,
    knownSpreadCount: 1,
    finalSpreadCount: 1,
    createdAt: 1,
  };
}

function frame(revisionId: string): ReaderSpreadFrame {
  return {
    sessionId: 'session-1',
    revisionId,
    spreadIndex: 0,
    pageIndexes: [0],
    viewport: { width: 400, height: 600 },
    displayList: { width: 400, height: 600, commands: [] },
    textRuns: [],
    targets: [],
    resourceRefs: [],
    primaryLocator: { href: 'page:0', mediaType: 'application/xhtml+xml', progression: 0 },
  };
}

function controlledHandler(): {
  readonly commands: ReaderRuntimeCommand[];
  readonly handleCommand: (command: ReaderRuntimeCommand) => Promise<ReaderRuntimeResponse>;
  readonly resolve: (requestId: ReaderRuntimeRequestId, response: ReaderRuntimeResponse) => void;
} {
  const commands: ReaderRuntimeCommand[] = [];
  const resolvers = new Map<ReaderRuntimeRequestId, (response: ReaderRuntimeResponse) => void>();
  return {
    commands,
    handleCommand(command) {
      commands.push(command);
      return new Promise<ReaderRuntimeResponse>((resolve) => {
        resolvers.set(command.requestId, resolve);
      });
    },
    resolve(requestId, response) {
      const resolve = resolvers.get(requestId);
      if (!resolve) throw new Error(`No pending request ${requestId}`);
      resolvers.delete(requestId);
      resolve(response);
    },
  };
}

function expectTransportError(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    name: 'ReaderRuntimeClientError',
    protocolError: { code },
  });
}

function makePage(index: number): Page {
  return {
    index,
    bounds: { x: 0, y: 0, width: 400, height: 600 },
    content: [],
  };
}

function paginationResult(pages: readonly Page[]): PaginationResult {
  return {
    pages,
    chapterMap: new Map([['ch1', { startPage: 0, endPage: Math.max(0, pages.length - 1) }]]),
    anchorMap: new Map<string, never>(),
    chapterTextIndices: new Map<string, never>(),
    footnoteMap: new Map<string, never>(),
  };
}

function makeDocument(): EpubDocument {
  return {
    packageDocument: {
      metadata: { title: 'Book', language: 'en', identifier: 'book-id' },
      manifest: [{ id: 'ch1', href: 'ch1.xhtml', mediaType: 'application/xhtml+xml' }],
      spine: [{ idref: 'ch1', linear: true }],
    },
    readChapter: () => undefined,
    stylesheets: new Map<string, string>(),
    fonts: new Map<string, Uint8Array>(),
    images: new Map<string, Uint8Array>(),
    toc: [],
    close: () => undefined,
  };
}

function frameFromInput(input: Parameters<BuildReaderSessionFrame>[0]): ReaderSpreadFrame {
  return {
    sessionId: input.sessionId,
    revisionId: input.revisionId,
    spreadIndex: input.spread.index,
    pageIndexes: [input.spread.left?.index, input.spread.right?.index].filter(
      (index): index is number => index !== undefined,
    ),
    viewport: { width: input.layout.viewportWidth, height: input.layout.viewportHeight },
    displayList: {
      width: input.layout.viewportWidth,
      height: input.layout.viewportHeight,
      commands: [],
    },
    textRuns: [],
    targets: [],
    resourceRefs: [],
    primaryLocator: {
      href: `spread:${String(input.spread.index)}`,
      mediaType: 'application/xhtml+xml',
      progression: 0,
    },
  };
}

function dispatcherDeps(): CreateReaderRuntimeDispatcherInput {
  return {
    openPublication: () => Promise.resolve(makeDocument()),
    createTextMeasurer: (): TextMeasurer => createMockTextMeasurer(),
    createSessionId: () => 'session-1',
    createRevisionId: () => 'revision-1',
    paginateRevision: () => paginationResult([makePage(0)]),
    buildFrame: frameFromInput,
    storeResourceTransfer: () => 'transfer-1',
    releaseResourceTransfers: () => undefined,
  };
}

function requestIds(...ids: readonly ReaderRuntimeRequestId[]): () => ReaderRuntimeRequestId {
  let index = 0;
  return () => ids[index++] ?? `request-extra-${String(index)}`;
}

describe('createInProcessReaderRuntimeTransport', () => {
  it('correlates concurrent commands by requestId even when responses resolve out of order', async () => {
    const handler = controlledHandler();
    const transport = createInProcessReaderRuntimeTransport({
      handleCommand: handler.handleCommand,
    });

    const open = transport.post(openCommand('open-1'));
    const create = transport.post(createRevisionCommand('create-1'));
    handler.resolve('create-1', successResponse(createRevisionCommand('create-1')));
    handler.resolve('open-1', successResponse(openCommand('open-1')));

    await expect(create).resolves.toMatchObject({ requestId: 'create-1', kind: 'createRevision' });
    await expect(open).resolves.toMatchObject({ requestId: 'open-1', kind: 'openSession' });
    expect(handler.commands.map((command) => command.requestId)).toEqual(['open-1', 'create-1']);
  });

  it('rejects response envelopes with mismatched requestId, sessionId, or revisionId', async () => {
    const requestMismatch = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({ ...successResponse(command), requestId: 'wrong-request' }),
    });
    await expectTransportError(requestMismatch.post(openCommand('open-1')), 'bad-request');

    const sessionMismatch = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({ ...successResponse(command), sessionId: 'wrong-session' }),
    });
    await expectTransportError(
      sessionMismatch.post(createRevisionCommand('create-1')),
      'bad-request',
    );

    const revisionMismatch = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({ ...successResponse(command), revisionId: 'wrong-revision' }),
    });
    await expectTransportError(revisionMismatch.post(frameCommand('frame-1')), 'bad-request');
  });

  it('rejects malformed openSession success ids', async () => {
    const missingSession = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'openSession',
          ok: true,
          payload: {
            publication: {
              metadata: { title: 'Book', language: 'en', identifier: 'book-id' },
              spineItemCount: 1,
            },
          },
        } as unknown as ReaderRuntimeResponse),
    });
    await expectTransportError(missingSession.post(openCommand('open-1')), 'bad-request');

    const invalidSession = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({
          ...successResponse(command),
          sessionId: 123,
        } as unknown as ReaderRuntimeResponse),
    });
    await expectTransportError(invalidSession.post(openCommand('open-2')), 'bad-request');
  });

  it('rejects malformed revision-scoped success ids', async () => {
    const missingCreateRevision = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'createRevision',
          ok: true,
          sessionId: 'session-1',
          payload: { revision: revision('revision-1') },
        } as unknown as ReaderRuntimeResponse),
    });
    await expectTransportError(
      missingCreateRevision.post(createRevisionCommand('create-1')),
      'bad-request',
    );

    const emptyCreateRevision = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({
          ...successResponse(command),
          revisionId: '',
        } as unknown as ReaderRuntimeResponse),
    });
    await expectTransportError(
      emptyCreateRevision.post(createRevisionCommand('create-2')),
      'bad-request',
    );

    const missingFrameRevision = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'getSpreadFrame',
          ok: true,
          sessionId: 'session-1',
          payload: { frame: frame('revision-1') },
        } as unknown as ReaderRuntimeResponse),
    });
    await expectTransportError(missingFrameRevision.post(frameCommand('frame-1')), 'bad-request');

    const invalidFrameRevision = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({
          ...successResponse(command),
          revisionId: 123,
        } as unknown as ReaderRuntimeResponse),
    });
    await expectTransportError(invalidFrameRevision.post(frameCommand('frame-2')), 'bad-request');

    const duplicateSearchRevision = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'search',
          ok: true,
          sessionId: command.sessionId,
          revisionId: command.revisionId,
          payload: { revisionId: 'revision-old', results: [], hasMore: false },
        } as unknown as ReaderRuntimeResponse),
    });
    await expectTransportError(
      duplicateSearchRevision.post(searchCommand('search-1')),
      'bad-request',
    );

    const geometryPayloadMismatch = createInProcessReaderRuntimeTransport({
      handleCommand: (command) =>
        Promise.resolve({
          protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
          requestId: command.requestId,
          kind: 'resolveLocatorGeometry',
          ok: true,
          sessionId: command.sessionId,
          revisionId: command.revisionId,
          payload: {
            locator: GEOMETRY_LOCATOR,
            revisionId: 'revision-old',
            segments: [],
          },
        } as unknown as ReaderRuntimeResponse),
    });
    await expectTransportError(
      geometryPayloadMismatch.post(geometryCommand('geometry-1')),
      'bad-request',
    );
  });

  it('rejects new posts after dispose without calling the handler', async () => {
    let calls = 0;
    const transport = createInProcessReaderRuntimeTransport({
      handleCommand: (command) => {
        calls++;
        return Promise.resolve(successResponse(command));
      },
    });

    transport.dispose();

    await expectTransportError(transport.post(openCommand('open-1')), 'bad-request');
    expect(calls).toBe(0);
  });

  it('rejects pending requests when disposed', async () => {
    const handler = controlledHandler();
    const transport = createInProcessReaderRuntimeTransport({
      handleCommand: handler.handleCommand,
    });

    const pending = transport.post(frameCommand('frame-1'));
    transport.dispose();

    await expect(pending).rejects.toMatchObject({
      name: 'ReaderRuntimeClientError',
      requestId: 'frame-1',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      protocolError: { code: 'bad-request' },
    });
  });

  it('rejects handler failures as structured transport errors', async () => {
    const transport = createInProcessReaderRuntimeTransport({
      handleCommand: () => Promise.reject(new Error('handler failed')),
    });

    await expectTransportError(transport.post(openCommand('open-1')), 'internal-error');
  });

  it('lets the runtime client consume an in-process dispatcher through transport', async () => {
    const dispatcher = createReaderRuntimeDispatcher(dispatcherDeps());
    const transport = createInProcessReaderRuntimeTransport({
      handleCommand: (command) => dispatcher.handleCommand(command),
    });
    const client = createReaderRuntimeClient({
      dispatch: (command) => transport.post(command),
      createRequestId: requestIds('open-1', 'revision-1', 'frame-1', 'close-1'),
    });

    await expect(client.openSession('book.epub')).resolves.toMatchObject({
      metadata: { title: 'Book' },
      spineItemCount: 1,
    });
    await expect(client.createRevision(LAYOUT)).resolves.toMatchObject({ id: 'revision-1' });
    await expect(client.getSpreadFrame({ spreadIndex: 0 })).resolves.toMatchObject({
      sessionId: 'session-1',
      revisionId: 'revision-1',
      spreadIndex: 0,
    });
    await expect(client.close()).resolves.toBeUndefined();
  });
});
