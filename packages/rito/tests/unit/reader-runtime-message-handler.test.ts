import { describe, expect, it } from 'vitest';
import type { Page } from '../../src/layout/core/types';
import type { TextMeasurer } from '../../src/layout/text/text-measurer';
import type { Logger } from '../../src/utils/logger';
import type { EpubDocument, PaginationResult } from '../../src/runtime/types';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  createReaderRuntimeClient,
  createReaderRuntimeDispatcher,
  createReaderRuntimeMessageHandler,
  createReaderRuntimeMessageTransport,
  ReaderRuntimeMessageHandlerSetupError,
  type BuildReaderSessionFrame,
  type CreateReaderRuntimeDispatcherInput,
  type JsonValue,
  type ReaderRuntimeCommand,
  type ReaderRuntimeDispatcher,
  type ReaderRuntimeMessagePort,
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

function openCommand(requestId: ReaderRuntimeRequestId): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'openSession',
    payload: { publicationRef: 'book.epub' },
  };
}

function commandMessage(command: ReaderRuntimeCommand): unknown {
  return { kind: 'reader-runtime-command', command };
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
        payload: {
          revision: {
            id: 'revision-1',
            sessionId: command.sessionId,
            layoutKey: 'layout-1',
            status: 'ready',
            knownSpreadCount: 1,
            finalSpreadCount: 1,
            createdAt: 1,
          },
        },
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
    case 'closeSession':
      return {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        kind: 'closeSession',
        ok: true,
        sessionId: command.sessionId,
        payload: { closed: true },
      };
    default:
      return {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: command.requestId,
        kind: 'error',
        ok: false,
        sessionId: command.sessionId,
        revisionId: command.revisionId,
        error: { code: 'not-supported', message: 'unsupported' },
      };
  }
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

function createFakePort(): {
  readonly port: ReaderRuntimeMessagePort;
  readonly sent: readonly JsonValue[];
  readonly emit: (message: unknown) => void;
  readonly listenerCount: () => number;
} {
  const sent: JsonValue[] = [];
  const listeners = new Set<(message: unknown) => void>();
  return {
    port: {
      postMessage(message) {
        sent.push(message);
      },
      subscribe(listener) {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    sent,
    emit(message) {
      for (const listener of [...listeners]) {
        listener(message);
      }
    },
    listenerCount() {
      return listeners.size;
    },
  };
}

function createLinkedPorts(): {
  readonly clientPort: ReaderRuntimeMessagePort;
  readonly serverPort: ReaderRuntimeMessagePort;
} {
  const clientListeners = new Set<(message: unknown) => void>();
  const serverListeners = new Set<(message: unknown) => void>();
  return {
    clientPort: {
      postMessage(message) {
        for (const listener of [...serverListeners]) listener(message);
      },
      subscribe(listener) {
        clientListeners.add(listener);
        return () => {
          clientListeners.delete(listener);
        };
      },
    },
    serverPort: {
      postMessage(message) {
        for (const listener of [...clientListeners]) listener(message);
      },
      subscribe(listener) {
        serverListeners.add(listener);
        return () => {
          serverListeners.delete(listener);
        };
      },
    },
  };
}

function createStubDispatcher(
  handleCommand?: (command: ReaderRuntimeCommand) => Promise<ReaderRuntimeResponse>,
): ReaderRuntimeDispatcher & {
  readonly commands: readonly ReaderRuntimeCommand[];
  readonly disposeCalls: () => number;
} {
  const commands: ReaderRuntimeCommand[] = [];
  let disposeCount = 0;
  return {
    commands,
    disposeCalls: () => disposeCount,
    handleCommand(command) {
      commands.push(command);
      return handleCommand?.(command) ?? Promise.resolve(successResponse(command));
    },
    dispose() {
      disposeCount++;
    },
  };
}

function responseAt(messages: readonly JsonValue[], index = 0): ReaderRuntimeResponse {
  const message = messages[index];
  if (!isRecord(message) || message['kind'] !== 'reader-runtime-response') {
    throw new Error(`Expected response message at index ${String(index)}`);
  }
  return message['response'] as unknown as ReaderRuntimeResponse;
}

function isRecord(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

async function flushMessages(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function makeLogger(): {
  readonly logger: Logger;
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];
  return {
    warnings,
    errors,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn(message) {
        warnings.push(message);
      },
      error(message) {
        errors.push(message);
      },
    },
  };
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

describe('createReaderRuntimeMessageHandler', () => {
  it('dispatches command envelopes and posts response envelopes', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher();
    createReaderRuntimeMessageHandler({ port: fake.port, dispatcher });

    fake.emit(commandMessage(openCommand('open-1')));
    await flushMessages();

    expect(dispatcher.commands).toEqual([openCommand('open-1')]);
    expect(responseAt(fake.sent)).toMatchObject({
      kind: 'openSession',
      ok: true,
      requestId: 'open-1',
      sessionId: 'session-1',
    });
  });

  it('returns bad-request for invalid command kind with requestId', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher();
    createReaderRuntimeMessageHandler({ port: fake.port, dispatcher });

    fake.emit({
      kind: 'reader-runtime-command',
      command: {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'bad-1',
        kind: 'unknownCommand',
      },
    });
    await flushMessages();

    expect(dispatcher.commands).toHaveLength(0);
    expect(responseAt(fake.sent)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'bad-1',
      error: { code: 'bad-request' },
    });
  });

  it('returns bad-request for malformed prefetch payloads before dispatch', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher();
    createReaderRuntimeMessageHandler({ port: fake.port, dispatcher });

    fake.emit({
      kind: 'reader-runtime-command',
      command: {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'prefetch-1',
        kind: 'prefetch',
        sessionId: 'session-1',
        revisionId: 'revision-1',
        payload: {},
      },
    });
    await flushMessages();

    expect(dispatcher.commands).toHaveLength(0);
    expect(responseAt(fake.sent)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'prefetch-1',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      error: { code: 'bad-request' },
    });
  });

  it('returns bad-request for malformed search payloads before dispatch', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher();
    createReaderRuntimeMessageHandler({ port: fake.port, dispatcher });

    fake.emit({
      kind: 'reader-runtime-command',
      command: {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'search-1',
        kind: 'search',
        sessionId: 'session-1',
        revisionId: 'revision-1',
        payload: { limit: 1 },
      },
    });
    fake.emit({
      kind: 'reader-runtime-command',
      command: {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'search-2',
        kind: 'search',
        sessionId: 'session-1',
        revisionId: 'revision-1',
        payload: { query: 'Chapter', limit: 0 },
      },
    });
    fake.emit({
      kind: 'reader-runtime-command',
      command: {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'search-3',
        kind: 'search',
        sessionId: 'session-1',
        revisionId: 'revision-1',
        payload: { query: 'Chapter', revisionId: 'revision-2' },
      },
    });
    await flushMessages();

    expect(dispatcher.commands).toHaveLength(0);
    expect(responseAt(fake.sent, 0)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'search-1',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      error: { code: 'bad-request' },
    });
    expect(responseAt(fake.sent, 1)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'search-2',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      error: { code: 'bad-request' },
    });
    expect(responseAt(fake.sent, 2)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'search-3',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      error: { code: 'bad-request' },
    });
  });

  it('returns bad-request for malformed locator, geometry, footnote, and resource payloads before dispatch', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher();
    createReaderRuntimeMessageHandler({ port: fake.port, dispatcher });

    fake.emit({
      kind: 'reader-runtime-command',
      command: {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'locator-1',
        kind: 'resolveLocator',
        sessionId: 'session-1',
        revisionId: 'revision-1',
        payload: {},
      },
    });
    fake.emit({
      kind: 'reader-runtime-command',
      command: {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'geometry-1',
        kind: 'resolveLocatorGeometry',
        sessionId: 'session-1',
        revisionId: 'revision-1',
        payload: {},
      },
    });
    fake.emit({
      kind: 'reader-runtime-command',
      command: {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'footnote-1',
        kind: 'getFootnote',
        sessionId: 'session-1',
        revisionId: 'revision-1',
        payload: {},
      },
    });
    fake.emit({
      kind: 'reader-runtime-command',
      command: {
        protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
        requestId: 'resource-1',
        kind: 'getResource',
        sessionId: 'session-1',
        revisionId: 'revision-1',
        payload: {},
      },
    });
    await flushMessages();

    expect(dispatcher.commands).toHaveLength(0);
    expect(responseAt(fake.sent, 0)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'locator-1',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      error: { code: 'bad-request' },
    });
    expect(responseAt(fake.sent, 1)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'geometry-1',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      error: { code: 'bad-request' },
    });
    expect(responseAt(fake.sent, 2)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'footnote-1',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      error: { code: 'bad-request' },
    });
    expect(responseAt(fake.sent, 3)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'resource-1',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      error: { code: 'bad-request' },
    });
  });

  it('ignores missing requestId and response messages without blocking later commands', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher();
    const log = makeLogger();
    createReaderRuntimeMessageHandler({ port: fake.port, dispatcher, logger: log.logger });

    fake.emit({ kind: 'reader-runtime-command', command: { kind: 'openSession' } });
    fake.emit({
      kind: 'reader-runtime-response',
      response: successResponse(openCommand('ignored')),
    });
    fake.emit(commandMessage(openCommand('open-1')));
    await flushMessages();

    expect(dispatcher.commands).toEqual([openCommand('open-1')]);
    expect(fake.sent).toHaveLength(1);
    expect(log.warnings.length).toBeGreaterThan(0);
  });

  it('converts dispatcher throws into structured error responses', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher(() => Promise.reject(new Error('dispatch failed')));
    createReaderRuntimeMessageHandler({ port: fake.port, dispatcher });

    fake.emit(commandMessage(openCommand('open-1')));
    await flushMessages();

    expect(responseAt(fake.sent)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'open-1',
      error: { code: 'internal-error' },
    });
  });

  it('replaces non-serializable dispatcher responses with internal errors', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher((command) =>
      Promise.resolve({
        ...successResponse(command),
        callback: () => undefined,
      } as unknown as ReaderRuntimeResponse),
    );
    createReaderRuntimeMessageHandler({ port: fake.port, dispatcher });

    fake.emit(commandMessage(openCommand('open-1')));
    await flushMessages();

    expect(responseAt(fake.sent)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'open-1',
      error: { code: 'internal-error' },
    });
  });

  it('replaces dispatcher responses with mismatched ids using the original command ids', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher((command) =>
      Promise.resolve({
        ...successResponse(command),
        requestId: 'wrong-request',
      }),
    );
    createReaderRuntimeMessageHandler({ port: fake.port, dispatcher });

    fake.emit(commandMessage(openCommand('open-1')));
    await flushMessages();

    expect(responseAt(fake.sent)).toMatchObject({
      kind: 'error',
      ok: false,
      requestId: 'open-1',
      error: { code: 'internal-error' },
    });
  });

  it('logs postMessage failures without throwing from the listener', async () => {
    const log = makeLogger();
    const dispatcher = createStubDispatcher();
    const handler = createReaderRuntimeMessageHandler({
      dispatcher,
      logger: log.logger,
      port: {
        postMessage() {
          throw new Error('send failed');
        },
        subscribe(listener) {
          listener(commandMessage(openCommand('open-1')));
          return () => undefined;
        },
      },
    });
    await flushMessages();

    expect(dispatcher.commands).toEqual([openCommand('open-1')]);
    expect(log.errors).toEqual(['Reader runtime response postMessage failed']);
    handler.dispose();
  });

  it('throws a typed setup error when subscribe fails', () => {
    const dispatcher = createStubDispatcher();

    expect(() => {
      createReaderRuntimeMessageHandler({
        dispatcher,
        port: {
          postMessage: () => undefined,
          subscribe() {
            throw new Error('attach failed');
          },
        },
      });
    }).toThrow(ReaderRuntimeMessageHandlerSetupError);
  });

  it('makes dispatcher ownership explicit on dispose', () => {
    const ownedPort = createFakePort();
    const ownedDispatcher = createStubDispatcher();
    const owned = createReaderRuntimeMessageHandler({
      port: ownedPort.port,
      dispatcher: ownedDispatcher,
      disposeDispatcher: true,
    });

    const borrowedPort = createFakePort();
    const borrowedDispatcher = createStubDispatcher();
    const borrowed = createReaderRuntimeMessageHandler({
      port: borrowedPort.port,
      dispatcher: borrowedDispatcher,
    });

    owned.dispose();
    borrowed.dispose();

    expect(ownedPort.listenerCount()).toBe(0);
    expect(borrowedPort.listenerCount()).toBe(0);
    expect(ownedDispatcher.disposeCalls()).toBe(1);
    expect(borrowedDispatcher.disposeCalls()).toBe(0);
  });

  it('logs dispatcher dispose failures while still unsubscribing', () => {
    const fake = createFakePort();
    const log = makeLogger();
    const dispatcher = createStubDispatcher();
    const failingDispatcher: ReaderRuntimeDispatcher = {
      handleCommand: (command) => dispatcher.handleCommand(command),
      dispose() {
        throw new Error('dispose failed');
      },
    };
    const handler = createReaderRuntimeMessageHandler({
      port: fake.port,
      dispatcher: failingDispatcher,
      disposeDispatcher: true,
      logger: log.logger,
    });

    handler.dispose();

    expect(fake.listenerCount()).toBe(0);
    expect(log.errors).toEqual(['Reader runtime dispatcher dispose failed']);
  });

  it('connects client, message transport, message handler, and dispatcher end to end', async () => {
    const ports = createLinkedPorts();
    const dispatcher = createReaderRuntimeDispatcher(dispatcherDeps());
    const handler = createReaderRuntimeMessageHandler({
      port: ports.serverPort,
      dispatcher,
      disposeDispatcher: true,
    });
    const transport = createReaderRuntimeMessageTransport({ port: ports.clientPort });
    const client = createReaderRuntimeClient({
      dispatch: (command) => transport.post(command),
      createRequestId: requestIds('open-1', 'revision-1', 'frame-1', 'close-1'),
    });

    await expect(client.openSession('book.epub')).resolves.toMatchObject({
      metadata: { title: 'Book' },
    });
    await expect(client.createRevision(LAYOUT)).resolves.toMatchObject({ id: 'revision-1' });
    await expect(client.getSpreadFrame({ spreadIndex: 0 })).resolves.toMatchObject({
      sessionId: 'session-1',
      revisionId: 'revision-1',
      spreadIndex: 0,
    });
    await expect(client.close()).resolves.toBeUndefined();

    transport.dispose();
    handler.dispose();
  });
});
