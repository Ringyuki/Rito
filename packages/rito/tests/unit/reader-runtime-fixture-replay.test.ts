import { describe, expect, it } from 'vitest';
import {
  createReaderRuntimeMessageHandler,
  createReaderRuntimeMessageTransport,
  type JsonValue,
  type ReaderRuntimeCommand,
  type ReaderRuntimeDispatcher,
  type ReaderRuntimeMessagePort,
  type ReaderRuntimeResponse,
} from '../../src/runtime/reader-session';
import { createReaderRuntimeWorkerEndpoint } from '../../src/web/reader-runtime-worker-endpoint';
import {
  readProtocolFixtures,
  replayJson,
  type RuntimeProtocolFixtureScenario,
} from '../helpers/reader-runtime-fixtures';

function responseMessage(response: ReaderRuntimeResponse): JsonValue {
  return { kind: 'reader-runtime-response', response } as unknown as JsonValue;
}

function commandMessage(command: ReaderRuntimeCommand): JsonValue {
  return { kind: 'reader-runtime-command', command } as unknown as JsonValue;
}

function createFakePort(): {
  readonly port: ReaderRuntimeMessagePort;
  readonly sent: readonly JsonValue[];
  readonly emit: (message: unknown) => void;
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
      for (const listener of [...listeners]) listener(message);
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

function createFixtureDispatcher(
  scenarios: readonly RuntimeProtocolFixtureScenario[],
): ReaderRuntimeDispatcher {
  const responseByRequestId = new Map(
    scenarios.map((scenario) => [scenario.command.requestId, scenario.response]),
  );
  return {
    handleCommand(command) {
      const response = responseByRequestId.get(command.requestId);
      if (response === undefined) {
        throw new Error(`No fixture response for ${command.requestId}`);
      }
      return Promise.resolve(replayJson(response));
    },
    dispose() {
      return undefined;
    },
  };
}

function responseAt(messages: readonly JsonValue[], index: number): ReaderRuntimeResponse {
  const message = messages[index];
  if (!isRecord(message) || message['kind'] !== 'reader-runtime-response') {
    throw new Error(`Expected reader runtime response message at ${String(index)}`);
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

async function emitCommandAndReadResponse(
  fake: ReturnType<typeof createFakePort>,
  command: ReaderRuntimeCommand,
): Promise<ReaderRuntimeResponse> {
  const index = fake.sent.length;
  fake.emit(commandMessage(replayJson(command)));
  await flushMessages();
  return responseAt(fake.sent, index);
}

describe('reader runtime protocol fixture replay across message boundaries', () => {
  it('replays fixed success and structured-error fixtures over message transport', async () => {
    const fake = createFakePort();
    const transport = createReaderRuntimeMessageTransport({ port: fake.port });
    const fixtures = readProtocolFixtures();
    const scenarios = [...fixtures.successPath, ...fixtures.structuredErrors];

    const pending = scenarios.map((scenario) => transport.post(replayJson(scenario.command)));
    expect(fake.sent).toEqual(
      scenarios.map((scenario) => commandMessage(replayJson(scenario.command))),
    );

    for (const scenario of [...scenarios].reverse()) {
      fake.emit(responseMessage(replayJson(scenario.response)));
    }

    for (const [index, scenario] of scenarios.entries()) {
      await expect(pending[index]).resolves.toEqual(scenario.response);
    }
    transport.dispose();
  });

  it('rejects fixed correlated malformed fixtures over message transport', async () => {
    const fixtures = readProtocolFixtures();
    const correlated = fixtures.malformedOrStaleEnvelopes.filter(
      (scenario) => scenario.command.requestId === scenario.response.requestId,
    );

    for (const scenario of correlated) {
      const fake = createFakePort();
      const transport = createReaderRuntimeMessageTransport({ port: fake.port });
      const pending = transport.post(replayJson(scenario.command));
      fake.emit(responseMessage(replayJson(scenario.response)));

      await expect(pending).rejects.toMatchObject({
        protocolError: { code: scenario.expectedErrorCode },
      });
      transport.dispose();
    }
  });

  it('replays fixed fixtures through message handler without a runtime session', async () => {
    const fixtures = readProtocolFixtures();
    const scenarios = [
      ...fixtures.successPath,
      ...fixtures.structuredErrors,
      ...fixtures.malformedOrStaleEnvelopes,
    ];
    const fake = createFakePort();
    const handler = createReaderRuntimeMessageHandler({
      port: fake.port,
      dispatcher: createFixtureDispatcher(scenarios),
    });

    for (const scenario of fixtures.successPath) {
      await expect(emitCommandAndReadResponse(fake, scenario.command)).resolves.toEqual(
        scenario.response,
      );
    }
    for (const scenario of fixtures.structuredErrors) {
      await expect(emitCommandAndReadResponse(fake, scenario.command)).resolves.toEqual(
        scenario.response,
      );
    }
    for (const scenario of fixtures.malformedOrStaleEnvelopes) {
      await expect(emitCommandAndReadResponse(fake, scenario.command)).resolves.toMatchObject({
        kind: 'error',
        ok: false,
        requestId: scenario.command.requestId,
        sessionId: scenario.command.sessionId,
        revisionId: scenario.command.revisionId,
        error: { code: 'internal-error' },
      });
    }

    handler.dispose();
  });

  it('replays fixed fixtures through worker endpoint without a runtime session', async () => {
    const fixtures = readProtocolFixtures();
    const scenarios = [
      ...fixtures.successPath,
      ...fixtures.structuredErrors,
      ...fixtures.malformedOrStaleEnvelopes,
    ];
    const ports = createLinkedPorts();
    const endpoint = createReaderRuntimeWorkerEndpoint({
      port: ports.serverPort,
      createDispatcher: () => createFixtureDispatcher(scenarios),
    });
    const transport = createReaderRuntimeMessageTransport({ port: ports.clientPort });

    for (const scenario of [...fixtures.successPath, ...fixtures.structuredErrors]) {
      await expect(transport.post(replayJson(scenario.command))).resolves.toEqual(
        scenario.response,
      );
    }
    for (const scenario of fixtures.malformedOrStaleEnvelopes) {
      await expect(transport.post(replayJson(scenario.command))).resolves.toMatchObject({
        kind: 'error',
        ok: false,
        requestId: scenario.command.requestId,
        sessionId: scenario.command.sessionId,
        revisionId: scenario.command.revisionId,
        error: { code: 'internal-error' },
      });
    }

    transport.dispose();
    endpoint.dispose();
  });
});
