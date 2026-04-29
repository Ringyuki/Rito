import { describe, expect, it } from 'vitest';
import type { Logger } from '../../src/utils/logger';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  createReaderRuntimeMessageTransport,
  type JsonValue,
  type ReaderRuntimeCommand,
  type ReaderRuntimeMessagePort,
  type ReaderRuntimeRequestId,
  type ReaderRuntimeResponse,
} from '../../src/runtime/reader-session';
import {
  createWebWorkerReaderRuntimeMessagePort,
  type WebWorkerReaderRuntimeMessageTarget,
} from '../../src/web/reader-runtime-worker-port';

type WorkerEventType = 'message' | 'messageerror' | 'error';
interface WorkerEventMap {
  readonly message: MessageEvent<unknown>;
  readonly messageerror: MessageEvent<unknown>;
  readonly error: ErrorEvent;
}
type TypedWorkerListener<K extends WorkerEventType> = (event: WorkerEventMap[K]) => void;
type WorkerListener = (event: MessageEvent<unknown> | ErrorEvent) => void;

function openCommand(requestId: ReaderRuntimeRequestId): ReaderRuntimeCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'openSession',
    payload: { publicationRef: 'book.epub' },
  };
}

function openResponse(command: ReaderRuntimeCommand): ReaderRuntimeResponse {
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

function responseMessage(response: ReaderRuntimeResponse): JsonValue {
  return { kind: 'reader-runtime-response', response } as unknown as JsonValue;
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

class FakeWorkerTarget implements WebWorkerReaderRuntimeMessageTarget {
  readonly sent: JsonValue[] = [];
  failOnAddEventType: WorkerEventType | undefined;
  private readonly listeners = new Map<WorkerEventType, Set<WorkerListener>>();

  postMessage(message: JsonValue): void {
    this.sent.push(message);
  }

  addEventListener<K extends WorkerEventType>(type: K, listener: TypedWorkerListener<K>): void {
    if (type === this.failOnAddEventType) {
      throw new Error(`Failed to add ${type} listener`);
    }
    this.listenersFor(type).add(listener as WorkerListener);
  }

  removeEventListener<K extends WorkerEventType>(type: K, listener: TypedWorkerListener<K>): void {
    this.listenersFor(type).delete(listener as WorkerListener);
  }

  emitMessage(data: unknown): void {
    this.emit('message', { data } as MessageEvent<unknown>);
  }

  emitMessageError(data: unknown): void {
    this.emit('messageerror', { data } as MessageEvent<unknown>);
  }

  emitError(message: string): void {
    this.emit('error', { message } as ErrorEvent);
  }

  listenerCount(type: WorkerEventType): number {
    return this.listenersFor(type).size;
  }

  private listenersFor(type: WorkerEventType): Set<WorkerListener> {
    let listeners = this.listeners.get(type);
    if (listeners === undefined) {
      listeners = new Set<WorkerListener>();
      this.listeners.set(type, listeners);
    }
    return listeners;
  }

  private emit(type: WorkerEventType, event: MessageEvent<unknown> | ErrorEvent): void {
    for (const listener of [...this.listenersFor(type)]) {
      listener(event);
    }
  }
}

describe('createWebWorkerReaderRuntimeMessagePort', () => {
  it('forwards JsonValue messages to worker.postMessage', () => {
    const worker = new FakeWorkerTarget();
    const port = createWebWorkerReaderRuntimeMessagePort(worker);
    const message: JsonValue = {
      kind: 'reader-runtime-command',
      command: openCommand('open-1') as unknown as JsonValue,
    };

    port.postMessage(message);

    expect(worker.sent).toEqual([message]);
  });

  it('subscribes to worker message events and forwards event data', () => {
    const worker = new FakeWorkerTarget();
    const port = createWebWorkerReaderRuntimeMessagePort(worker);
    const received: unknown[] = [];

    const unsubscribe = port.subscribe((message) => {
      received.push(message);
    });
    worker.emitMessage({ kind: 'reader-runtime-response', response: { requestId: 'open-1' } });

    expect(received).toEqual([
      { kind: 'reader-runtime-response', response: { requestId: 'open-1' } },
    ]);
    unsubscribe();
  });

  it('removes this adapter listener registrations on unsubscribe', () => {
    const worker = new FakeWorkerTarget();
    const port = createWebWorkerReaderRuntimeMessagePort(worker);
    const received: unknown[] = [];

    const unsubscribe = port.subscribe((message) => {
      received.push(message);
    });
    expect(worker.listenerCount('message')).toBe(1);
    expect(worker.listenerCount('messageerror')).toBe(1);
    expect(worker.listenerCount('error')).toBe(1);

    unsubscribe();
    worker.emitMessage({ kind: 'reader-runtime-response' });

    expect(worker.listenerCount('message')).toBe(0);
    expect(worker.listenerCount('messageerror')).toBe(0);
    expect(worker.listenerCount('error')).toBe(0);
    expect(received).toEqual([]);
  });

  it('cleans up already registered listeners when subscribe fails midway', () => {
    const worker = new FakeWorkerTarget();
    worker.failOnAddEventType = 'messageerror';
    const port = createWebWorkerReaderRuntimeMessagePort(worker);

    expect(() => {
      port.subscribe(() => undefined);
    }).toThrow('Failed to add messageerror listener');

    expect(worker.listenerCount('message')).toBe(0);
    expect(worker.listenerCount('messageerror')).toBe(0);
    expect(worker.listenerCount('error')).toBe(0);
  });

  it('logs worker error and messageerror events without notifying subscribers', () => {
    const worker = new FakeWorkerTarget();
    const log = makeLogger();
    const port = createWebWorkerReaderRuntimeMessagePort(worker, { logger: log.logger });
    const received: unknown[] = [];

    const unsubscribe = port.subscribe((message) => {
      received.push(message);
    });
    worker.emitError('worker failed');
    worker.emitMessageError({ bad: true });

    expect(log.errors).toEqual([
      'Reader runtime worker error',
      'Reader runtime worker messageerror',
    ]);
    expect(received).toEqual([]);
    unsubscribe();
  });

  it('can back the reader runtime message transport without extra protocol handling', async () => {
    const worker = new FakeWorkerTarget();
    const port: ReaderRuntimeMessagePort = createWebWorkerReaderRuntimeMessagePort(worker);
    const transport = createReaderRuntimeMessageTransport({ port });

    const pending = transport.post(openCommand('open-1'));
    expect(worker.sent).toHaveLength(1);

    worker.emitMessage(responseMessage(openResponse(openCommand('open-1'))));

    await expect(pending).resolves.toMatchObject({
      kind: 'openSession',
      requestId: 'open-1',
      sessionId: 'session-1',
    });
  });
});
