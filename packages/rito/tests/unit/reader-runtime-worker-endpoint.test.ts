import { describe, expect, it } from 'vitest';
import type { Page } from '../../src/layout/core/types';
import type { TextMeasurer } from '../../src/layout/text/text-measurer';
import type { Logger } from '../../src/utils/logger';
import type { EpubDocument, PaginationResult } from '../../src/runtime/types';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  createReaderRuntimeClient,
  createReaderRuntimeDispatcher,
  createInMemoryReaderResourceTransferStore,
  createReaderRuntimeMessageTransport,
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
import {
  ReaderRuntimeWorkerEndpointSetupError,
  createReaderRuntimeWorkerEndpoint,
} from '../../src/web/reader-runtime-worker-endpoint';
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

function successResponse(command: ReaderRuntimeCommand): ReaderRuntimeResponse {
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
}

function commandMessage(command: ReaderRuntimeCommand): JsonValue {
  return { kind: 'reader-runtime-command', command } as unknown as JsonValue;
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

function createStubDispatcher(): ReaderRuntimeDispatcher & {
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
      return Promise.resolve(successResponse(command));
    },
    dispose() {
      disposeCount++;
    },
  };
}

function makeLogger(): {
  readonly logger: Logger;
  readonly errors: readonly string[];
} {
  const errors: string[] = [];
  return {
    errors,
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error(message) {
        errors.push(message);
      },
    },
  };
}

async function flushMessages(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
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
    images: new Map<string, Uint8Array>([['Images/cover.png', new Uint8Array([1, 2, 3])]]),
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

function dispatcherDeps(
  overrides?: Partial<CreateReaderRuntimeDispatcherInput>,
): CreateReaderRuntimeDispatcherInput {
  return {
    openPublication: () => Promise.resolve(makeDocument()),
    createTextMeasurer: (): TextMeasurer => createMockTextMeasurer(),
    createSessionId: () => 'session-1',
    createRevisionId: () => 'revision-1',
    paginateRevision: () => paginationResult([makePage(0)]),
    buildFrame: frameFromInput,
    storeResourceTransfer: () => 'transfer-1',
    releaseResourceTransfers: () => undefined,
    ...(overrides ?? {}),
  };
}

function imageResource() {
  return {
    id: 'cover',
    kind: 'image' as const,
    href: 'Images/cover.png',
    mediaType: 'image/png',
  };
}

function requestIds(...ids: readonly ReaderRuntimeRequestId[]): () => ReaderRuntimeRequestId {
  let index = 0;
  return () => ids[index++] ?? `request-extra-${String(index)}`;
}

describe('createReaderRuntimeWorkerEndpoint', () => {
  it('connects host client and transport to a worker-owned dispatcher', async () => {
    const ports = createLinkedPorts();
    const endpoint = createReaderRuntimeWorkerEndpoint({
      port: ports.serverPort,
      createDispatcher: () => createReaderRuntimeDispatcher(dispatcherDeps()),
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
    endpoint.dispose();
  });

  it('returns resource payloads over the worker protocol while bytes stay in the transfer store', async () => {
    const ports = createLinkedPorts();
    const transfers = createInMemoryReaderResourceTransferStore();
    const endpoint = createReaderRuntimeWorkerEndpoint({
      port: ports.serverPort,
      createDispatcher: () =>
        createReaderRuntimeDispatcher(
          dispatcherDeps({
            storeResourceTransfer: (input) => transfers.storeTransfer(input),
            releaseResourceTransfers: (input) => {
              transfers.releaseTransfers(input);
            },
          }),
        ),
    });
    const transport = createReaderRuntimeMessageTransport({ port: ports.clientPort });
    const client = createReaderRuntimeClient({
      dispatch: (command) => transport.post(command),
      createRequestId: requestIds('open-1', 'revision-1', 'resource-1', 'close-1'),
    });

    await client.openSession('book.epub');
    await client.createRevision(LAYOUT);
    const payload = await client.getResource({ resource: imageResource() });

    expect(payload).toMatchObject({
      resource: { href: 'Images/cover.png' },
      byteLength: 3,
      transferId: 'transfer-1',
      mediaType: 'image/png',
    });
    expect(payload).not.toHaveProperty('bytes');
    expect(transfers.readTransfer(payload.transferId)).toMatchObject({
      sessionId: 'session-1',
      revisionId: 'revision-1',
      bytes: new Uint8Array([1, 2, 3]),
      byteLength: 3,
      mediaType: 'image/png',
    });
    expect(transfers.getTransferCount()).toBe(1);

    await client.close();
    expect(transfers.getTransferCount()).toBe(0);
    transport.dispose();
    endpoint.dispose();
  });

  it('throws a typed setup error when dispatcher creation fails', () => {
    const fake = createFakePort();

    expect(() => {
      createReaderRuntimeWorkerEndpoint({
        port: fake.port,
        createDispatcher() {
          throw new Error('dispatcher setup failed');
        },
      });
    }).toThrow(ReaderRuntimeWorkerEndpointSetupError);
  });

  it('disposes a created dispatcher when message handler setup fails', () => {
    const dispatcher = createStubDispatcher();
    const log = makeLogger();

    expect(() => {
      createReaderRuntimeWorkerEndpoint({
        logger: log.logger,
        createDispatcher: () => dispatcher,
        port: {
          postMessage: () => undefined,
          subscribe() {
            throw new Error('subscribe failed');
          },
        },
      });
    }).toThrow(ReaderRuntimeWorkerEndpointSetupError);

    expect(dispatcher.disposeCalls()).toBe(1);
    expect(log.errors).toEqual([]);
  });

  it('does not process inbound commands after endpoint dispose', async () => {
    const fake = createFakePort();
    const dispatcher = createStubDispatcher();
    const endpoint = createReaderRuntimeWorkerEndpoint({
      port: fake.port,
      createDispatcher: () => dispatcher,
    });

    endpoint.dispose();
    fake.emit(commandMessage(openCommand('open-1')));
    await flushMessages();

    expect(fake.listenerCount()).toBe(0);
    expect(dispatcher.commands).toEqual([]);
    expect(dispatcher.disposeCalls()).toBe(1);
  });
});
