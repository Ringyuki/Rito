import { describe, expect, it } from 'vitest';
import {
  READER_RUNTIME_PROTOCOL_VERSION,
  assertProtocolSerializable,
  createReaderRuntimeClient,
  createReaderRuntimeMessageTransport,
  type JsonValue,
  type ReaderRuntimeCommand,
  type ReaderRuntimeMessagePort,
  type ReaderRuntimeRequestId,
  type ReaderRuntimeResponse,
  type ReaderSpreadFrame,
} from '../../src/runtime/reader-session';

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

function responseMessage(response: ReaderRuntimeResponse): unknown {
  return { kind: 'reader-runtime-response', response };
}

function commandFromMessage(message: JsonValue): ReaderRuntimeCommand {
  const candidate = message as { readonly kind?: unknown; readonly command?: unknown };
  if (candidate.kind !== 'reader-runtime-command') {
    throw new Error('Expected reader-runtime-command message');
  }
  return candidate.command as ReaderRuntimeCommand;
}

function sentCommandAt(messages: readonly JsonValue[], index: number): ReaderRuntimeCommand {
  const message = messages[index];
  if (message === undefined) {
    throw new Error(`Expected sent message at index ${String(index)}`);
  }
  return commandFromMessage(message);
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

function requestIds(...ids: readonly ReaderRuntimeRequestId[]): () => ReaderRuntimeRequestId {
  let index = 0;
  return () => ids[index++] ?? `request-extra-${String(index)}`;
}

function expectTransportError(promise: Promise<unknown>, code: string): Promise<void> {
  return expect(promise).rejects.toMatchObject({
    name: 'ReaderRuntimeClientError',
    protocolError: { code },
  });
}

describe('createReaderRuntimeMessageTransport', () => {
  it('sends commands inside a reader runtime command envelope', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });

    const pending = transport.post(openCommand('open-1'));

    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]).toEqual({
      kind: 'reader-runtime-command',
      command: openCommand('open-1'),
    });
    expect(() => {
      assertProtocolSerializable(fake.sent[0]);
    }).not.toThrow();

    fake.emit(responseMessage(successResponse(openCommand('open-1'))));
    await expect(pending).resolves.toMatchObject({ kind: 'openSession', sessionId: 'session-1' });
  });

  it('correlates out-of-order response messages by requestId', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });

    const open = transport.post(openCommand('open-1'));
    const frameRequest = transport.post(frameCommand('frame-1'));
    fake.emit(responseMessage(successResponse(frameCommand('frame-1'))));
    fake.emit(responseMessage(successResponse(openCommand('open-1'))));

    await expect(frameRequest).resolves.toMatchObject({ requestId: 'frame-1' });
    await expect(open).resolves.toMatchObject({ requestId: 'open-1' });
  });

  it('replays JSON command-response fixtures over the message port boundary', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });
    const openFixture = replayJson(openCommand('fixture-open'));
    const frameFixture = replayJson(frameCommand('fixture-frame'));
    const responses = new Map(
      [openFixture, frameFixture].map((command) => [
        command.requestId,
        replayJson(responseMessage(successResponse(command))),
      ]),
    );

    const open = transport.post(openFixture);
    const frameRequest = transport.post(frameFixture);

    expect(fake.sent).toEqual([
      { kind: 'reader-runtime-command', command: openFixture },
      { kind: 'reader-runtime-command', command: frameFixture },
    ]);
    fake.emit(responses.get('fixture-frame'));
    fake.emit(responses.get('fixture-open'));

    await expect(frameRequest).resolves.toEqual(
      (responses.get('fixture-frame') as { readonly response: ReaderRuntimeResponse }).response,
    );
    await expect(open).resolves.toEqual(
      (responses.get('fixture-open') as { readonly response: ReaderRuntimeResponse }).response,
    );
  });

  it('rejects duplicate pending requestIds without posting a second message', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });

    const first = transport.post(openCommand('same-request'));
    const second = transport.post(openCommand('same-request'));

    expect(fake.sent).toHaveLength(1);
    await expectTransportError(second, 'bad-request');

    fake.emit(responseMessage(successResponse(openCommand('same-request'))));
    await expect(first).resolves.toMatchObject({ requestId: 'same-request' });
  });

  it('rejects port send failures as structured internal errors', async () => {
    let calls = 0;
    const transport = createReaderRuntimeMessageTransport({
      port: {
        postMessage() {
          calls++;
          throw new Error('send failed');
        },
        subscribe() {
          return () => undefined;
        },
      },
    });

    await expectTransportError(transport.post(openCommand('open-1')), 'internal-error');
    expect(calls).toBe(1);
  });

  it('returns a structured failing transport when subscribe throws', async () => {
    let postCalls = 0;
    const transport = createReaderRuntimeMessageTransport({
      port: {
        postMessage() {
          postCalls++;
        },
        subscribe() {
          throw new Error('attach failed');
        },
      },
    });

    await expectTransportError(transport.post(openCommand('open-1')), 'internal-error');
    expect(postCalls).toBe(0);
    transport.dispose();
  });

  it('ignores malformed inbound messages that cannot be correlated to a pending request', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });

    const pending = transport.post(openCommand('open-1'));
    fake.emit({ kind: 'reader-runtime-response', response: { kind: 'openSession', ok: true } });
    fake.emit({ kind: 'reader-runtime-log', response: { requestId: 'open-1' } });
    fake.emit(responseMessage(successResponse(openCommand('open-1'))));

    await expect(pending).resolves.toMatchObject({ requestId: 'open-1' });
  });

  it('rejects only the matched pending request when an inbound message is malformed', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });

    const open = transport.post(openCommand('open-1'));
    const frameRequest = transport.post(frameCommand('frame-1'));
    const openError = expectTransportError(open, 'bad-request');

    fake.emit({ kind: 'reader-runtime-response', response: { requestId: 'open-1' } });
    await openError;

    fake.emit(responseMessage(successResponse(frameCommand('frame-1'))));
    await expect(frameRequest).resolves.toMatchObject({ requestId: 'frame-1' });
  });

  it('rejects response messages with invalid correlation ids', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });

    const pending = transport.post(frameCommand('frame-1'));
    const error = expectTransportError(pending, 'bad-request');
    fake.emit(
      responseMessage({
        ...successResponse(frameCommand('frame-1')),
        sessionId: 'wrong-session',
      } as ReaderRuntimeResponse),
    );

    await error;
  });

  it('rejects response messages that are not JSON-safe', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });

    const pending = transport.post(openCommand('open-1'));
    const error = expectTransportError(pending, 'bad-request');
    fake.emit({
      kind: 'reader-runtime-response',
      response: {
        ...successResponse(openCommand('open-1')),
        callback: () => undefined,
      },
    });

    await error;
  });

  it('unsubscribes and rejects pending requests on dispose', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });

    const pending = transport.post(frameCommand('frame-1'));
    const pendingError = expect(pending).rejects.toMatchObject({
      name: 'ReaderRuntimeClientError',
      requestId: 'frame-1',
      sessionId: 'session-1',
      revisionId: 'revision-1',
      protocolError: { code: 'bad-request' },
    });

    expect(fake.listenerCount()).toBe(1);
    transport.dispose();
    expect(fake.listenerCount()).toBe(0);
    await pendingError;

    const sentCount = fake.sent.length;
    await expectTransportError(transport.post(openCommand('open-2')), 'bad-request');
    expect(fake.sent).toHaveLength(sentCount);
    fake.emit(responseMessage(successResponse(frameCommand('frame-1'))));
  });

  it('lets the runtime client consume a message transport through a fake port', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });
    const client = createReaderRuntimeClient({
      dispatch: (command) => transport.post(command),
      createRequestId: requestIds('open-1', 'revision-1', 'frame-1', 'close-1'),
    });

    const open = client.openSession('book.epub');
    fake.emit(responseMessage(successResponse(sentCommandAt(fake.sent, 0))));
    await expect(open).resolves.toMatchObject({ metadata: { title: 'Book' } });

    const revision = client.createRevision(LAYOUT);
    fake.emit(responseMessage(successResponse(sentCommandAt(fake.sent, 1))));
    await expect(revision).resolves.toMatchObject({ id: 'revision-1' });

    const spreadFrame = client.getSpreadFrame({ spreadIndex: 0 });
    fake.emit(responseMessage(successResponse(sentCommandAt(fake.sent, 2))));
    await expect(spreadFrame).resolves.toMatchObject({
      sessionId: 'session-1',
      revisionId: 'revision-1',
    });

    const close = client.close();
    fake.emit(responseMessage(successResponse(sentCommandAt(fake.sent, 3))));
    await expect(close).resolves.toBeUndefined();
  });
});

function replayJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as unknown as T;
}
