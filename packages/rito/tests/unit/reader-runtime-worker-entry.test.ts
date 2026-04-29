// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import type { Logger } from '../../src/utils/logger';
import {
  createReaderRuntimeClient,
  createReaderRuntimeMessageTransport,
  READER_RUNTIME_PROTOCOL_VERSION,
  type JsonValue,
  type ReaderLayoutRequest,
  type ReaderResourceRef,
  type ReaderRuntimeCommand,
  type ReaderRuntimeDispatcher,
  type ReaderRuntimeMessagePort,
  type ReaderRuntimeRequestId,
  type ReaderRuntimeResponse,
  type ReaderSpreadFrame,
} from '../../src/runtime/reader-session';
import { createReaderRuntimeWorkerDispatcherFactory } from '../../src/web/reader-runtime-worker-dispatcher';
import {
  createReaderRuntimeWorkerScopePort,
  startReaderRuntimeWorkerDispatcherFactoryEndpoint,
  startReaderRuntimeWorkerEndpoint,
  type ReaderRuntimeWorkerScope,
} from '../../src/web/reader-runtime-worker-entry';
import { ReaderRuntimeWorkerEndpointSetupError } from '../../src/web/reader-runtime-worker-endpoint';
import { buildMinimalEpub } from '../helpers/epub-builder';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

type ScopeEventType = 'message' | 'messageerror' | 'error';
interface ScopeEventMap {
  readonly message: MessageEvent<unknown>;
  readonly messageerror: MessageEvent<unknown>;
  readonly error: ErrorEvent;
}
type TypedScopeListener<K extends ScopeEventType> = (event: ScopeEventMap[K]) => void;
type ScopeListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

const LAYOUT: ReaderLayoutRequest = {
  viewport: { width: 400, height: 600 },
  spreadMode: 'single',
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

function successResponse(command: ReaderRuntimeCommand): ReaderRuntimeResponse {
  switch (command.kind) {
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
}

function commandMessage(command: ReaderRuntimeCommand): JsonValue {
  return { kind: 'reader-runtime-command', command } as unknown as JsonValue;
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

function imageResource(): ReaderResourceRef {
  return {
    id: 'cover',
    kind: 'image',
    href: 'Images/cover.png',
    mediaType: 'image/png',
  };
}

function bookBytes(): ArrayBuffer {
  return buildMinimalEpub({
    title: 'Worker Book',
    identifier: 'worker-book-id',
    images: [
      {
        id: 'cover',
        href: 'Images/cover.png',
        mediaType: 'image/png',
        data: new Uint8Array([1, 2, 3]),
      },
    ],
  });
}

function requestIds(...ids: readonly ReaderRuntimeRequestId[]): () => ReaderRuntimeRequestId {
  let index = 0;
  return () => ids[index++] ?? `request-extra-${String(index)}`;
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

class FakeWorkerScope implements ReaderRuntimeWorkerScope {
  readonly sent: JsonValue[] = [];
  failOnAddEventType: ScopeEventType | undefined;
  private readonly listeners = new Map<ScopeEventType, Set<ScopeListener>>();
  private readonly hostListeners = new Set<(message: unknown) => void>();

  postMessage(message: JsonValue): void {
    this.sent.push(message);
    for (const listener of [...this.hostListeners]) {
      listener(message);
    }
  }

  addEventListener<K extends ScopeEventType>(type: K, listener: TypedScopeListener<K>): void {
    if (type === this.failOnAddEventType) {
      throw new Error(`Failed to add ${type} listener`);
    }
    this.listenersFor(type).add(listener as ScopeListener);
  }

  removeEventListener<K extends ScopeEventType>(type: K, listener: TypedScopeListener<K>): void {
    this.listenersFor(type).delete(listener as ScopeListener);
  }

  emitMessage(data: unknown): void {
    this.emit('message', { data } as MessageEvent<unknown>);
  }

  listenerCount(type: ScopeEventType): number {
    return this.listenersFor(type).size;
  }

  createHostPort(): ReaderRuntimeMessagePort {
    return {
      postMessage: (message) => {
        this.emitMessage(message);
      },
      subscribe: (listener) => {
        this.hostListeners.add(listener);
        return () => {
          this.hostListeners.delete(listener);
        };
      },
    };
  }

  private listenersFor(type: ScopeEventType): Set<ScopeListener> {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set<ScopeListener>();
      this.listeners.set(type, listeners);
    }
    return listeners;
  }

  private emit(type: ScopeEventType, event: MessageEvent<unknown> | ErrorEvent): void {
    for (const listener of [...this.listenersFor(type)]) {
      listener(event);
    }
  }
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

describe('reader runtime worker entry', () => {
  it('wraps a worker scope as a message port without reading global scope', () => {
    const scope = new FakeWorkerScope();
    const port = createReaderRuntimeWorkerScopePort(scope);
    const received: unknown[] = [];

    const unsubscribe = port.subscribe((message) => {
      received.push(message);
    });
    port.postMessage({ kind: 'reader-runtime-response', response: { requestId: 'out-1' } });
    scope.emitMessage({ kind: 'reader-runtime-command', command: { requestId: 'in-1' } });

    expect(scope.sent).toEqual([
      { kind: 'reader-runtime-response', response: { requestId: 'out-1' } },
    ]);
    expect(received).toEqual([{ kind: 'reader-runtime-command', command: { requestId: 'in-1' } }]);
    unsubscribe();
  });

  it('starts an endpoint that dispatches scope command messages', async () => {
    const scope = new FakeWorkerScope();
    const dispatcher = createStubDispatcher();
    startReaderRuntimeWorkerEndpoint({
      scope,
      createDispatcher: () => dispatcher,
    });

    scope.emitMessage(commandMessage(openCommand('open-1')));
    await flushMessages();

    expect(dispatcher.commands).toEqual([openCommand('open-1')]);
    expect(responseAt(scope.sent)).toMatchObject({
      kind: 'openSession',
      ok: true,
      requestId: 'open-1',
      sessionId: 'session-1',
    });
  });

  it('replays JSON command-response fixtures through a worker scope endpoint', async () => {
    const scope = new FakeWorkerScope();
    const openFixture = replayJson(openCommand('fixture-open'));
    const frameFixture = replayJson(frameCommand('fixture-frame'));
    const responses = new Map(
      [openFixture, frameFixture].map((command) => [
        command.requestId,
        replayJson(successResponse(command)),
      ]),
    );
    const dispatcher = createStubDispatcher((command) => {
      const response = responses.get(command.requestId);
      if (!response) throw new Error(`No fixture response for ${command.requestId}`);
      return Promise.resolve(response);
    });
    startReaderRuntimeWorkerEndpoint({
      scope,
      createDispatcher: () => dispatcher,
    });

    scope.emitMessage(commandMessage(openFixture));
    scope.emitMessage(commandMessage(frameFixture));
    await flushMessages();

    expect(dispatcher.commands).toEqual([openFixture, frameFixture]);
    expect(responseAt(scope.sent, 0)).toEqual(responses.get('fixture-open'));
    expect(responseAt(scope.sent, 1)).toEqual(responses.get('fixture-frame'));
  });

  it('throws typed setup errors from dispatcher creation', () => {
    const scope = new FakeWorkerScope();

    expect(() => {
      startReaderRuntimeWorkerEndpoint({
        scope,
        createDispatcher() {
          throw new Error('dispatcher setup failed');
        },
      });
    }).toThrow(ReaderRuntimeWorkerEndpointSetupError);
  });

  it('cleans up dispatcher when scope subscription setup fails', () => {
    const scope = new FakeWorkerScope();
    const dispatcher = createStubDispatcher();
    const log = makeLogger();
    scope.failOnAddEventType = 'messageerror';

    expect(() => {
      startReaderRuntimeWorkerEndpoint({
        scope,
        logger: log.logger,
        createDispatcher: () => dispatcher,
      });
    }).toThrow(ReaderRuntimeWorkerEndpointSetupError);

    expect(dispatcher.disposeCalls()).toBe(1);
    expect(scope.listenerCount('message')).toBe(0);
    expect(log.errors).toEqual([]);
  });

  it('removes scope listeners and stops dispatching after dispose', async () => {
    const scope = new FakeWorkerScope();
    const dispatcher = createStubDispatcher();
    const endpoint = startReaderRuntimeWorkerEndpoint({
      scope,
      createDispatcher: () => dispatcher,
    });

    endpoint.dispose();
    scope.emitMessage(commandMessage(openCommand('open-1')));
    await flushMessages();

    expect(scope.listenerCount('message')).toBe(0);
    expect(scope.listenerCount('messageerror')).toBe(0);
    expect(scope.listenerCount('error')).toBe(0);
    expect(dispatcher.commands).toEqual([]);
    expect(dispatcher.disposeCalls()).toBe(1);
  });

  it('connects a host client to a factory-backed worker scope endpoint with resource transfers', async () => {
    const scope = new FakeWorkerScope();
    const factory = createReaderRuntimeWorkerDispatcherFactory({
      readPublicationBytes: () => Promise.resolve(bookBytes()),
      createTextMeasurer: () => createMockTextMeasurer(),
      createSessionId: () => 'session-1',
      createRevisionId: () => 'revision-1',
    });
    const endpoint = startReaderRuntimeWorkerDispatcherFactoryEndpoint({
      scope,
      dispatcherFactory: factory,
    });
    const transport = createReaderRuntimeMessageTransport({ port: scope.createHostPort() });
    const client = createReaderRuntimeClient({
      dispatch: (command) => transport.post(command),
      createRequestId: requestIds('open-1', 'revision-1', 'resource-1', 'close-1'),
    });

    await expect(client.openSession('book.epub')).resolves.toMatchObject({
      metadata: { title: 'Worker Book' },
    });
    await expect(client.createRevision(LAYOUT)).resolves.toMatchObject({
      id: 'revision-1',
      sessionId: 'session-1',
    });
    const payload = await client.getResource({ resource: imageResource() });

    expect(payload).toMatchObject({
      resource: { href: 'Images/cover.png' },
      transferId: 'transfer-1',
      byteLength: 3,
      mediaType: 'image/png',
    });
    expect(payload).not.toHaveProperty('bytes');
    expect(endpoint.resourceTransfers.readTransfer(payload.transferId)).toMatchObject({
      sessionId: 'session-1',
      revisionId: 'revision-1',
      bytes: new Uint8Array([1, 2, 3]),
    });

    await client.close();

    expect(endpoint.resourceTransfers.getTransferCount()).toBe(0);
    transport.dispose();
    endpoint.dispose();
  });
});

function replayJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as unknown as T;
}
