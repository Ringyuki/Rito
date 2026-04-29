import type { Logger } from '../../utils/logger';
import type { ReaderProtocolError, ReaderRuntimeResponse } from './protocol';
import { READER_RUNTIME_PROTOCOL_VERSION } from './protocol';
import { assertProtocolSerializable, createProtocolError } from './protocol-helpers';
import type { ReaderRuntimeDispatcher } from './dispatcher';
import {
  parseReaderRuntimeCommandMessage,
  readerRuntimeCommandIds,
  type RuntimeMessageIds,
} from './message-command';
import type { ReaderRuntimeMessagePort, ReaderRuntimeResponseMessage } from './message-transport';
import { validateRuntimeResponseEnvelope } from './response-validation';

export interface ReaderRuntimeMessageHandler {
  dispose(): void;
}

export interface CreateReaderRuntimeMessageHandlerInput {
  readonly port: ReaderRuntimeMessagePort;
  readonly dispatcher: ReaderRuntimeDispatcher;
  readonly disposeDispatcher?: boolean;
  readonly logger?: Logger;
}

export class ReaderRuntimeMessageHandlerSetupError extends Error {
  override readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'ReaderRuntimeMessageHandlerSetupError';
    this.cause = cause;
  }
}

interface ReaderRuntimeMessageHandlerState {
  readonly port: ReaderRuntimeMessagePort;
  readonly dispatcher: ReaderRuntimeDispatcher;
  readonly disposeDispatcher: boolean;
  readonly logger: Logger | undefined;
  unsubscribe: () => void;
  disposed: boolean;
}

export function createReaderRuntimeMessageHandler(
  input: CreateReaderRuntimeMessageHandlerInput,
): ReaderRuntimeMessageHandler {
  const state: ReaderRuntimeMessageHandlerState = {
    port: input.port,
    dispatcher: input.dispatcher,
    disposeDispatcher: input.disposeDispatcher ?? false,
    logger: input.logger,
    unsubscribe: () => undefined,
    disposed: false,
  };

  try {
    state.unsubscribe = input.port.subscribe((message) => {
      void handleReaderRuntimeCommandMessage(state, message);
    });
  } catch (error) {
    throw new ReaderRuntimeMessageHandlerSetupError(
      'Reader runtime message handler failed to subscribe',
      error,
    );
  }

  return {
    dispose() {
      disposeReaderRuntimeMessageHandler(state);
    },
  };
}

async function handleReaderRuntimeCommandMessage(
  state: ReaderRuntimeMessageHandlerState,
  message: unknown,
): Promise<void> {
  if (state.disposed) return;

  const parsed = parseReaderRuntimeCommandMessage(message);
  if (!parsed.ok) {
    handleInvalidCommandMessage(state, parsed);
    return;
  }

  const command = parsed.command;
  try {
    assertProtocolSerializable({ kind: 'reader-runtime-command', command });
  } catch (error) {
    sendCommandSerializationError(state, readerRuntimeCommandIds(command), error);
    return;
  }

  try {
    const response = await state.dispatcher.handleCommand(command);
    sendDispatcherResponse(state, command, response);
  } catch (error) {
    sendResponse(
      state,
      readerRuntimeCommandIds(command),
      errorResponse(
        readerRuntimeCommandIds(command),
        createProtocolError('internal-error', 'Reader runtime dispatcher failed', {
          details: { cause: errorMessage(error) },
        }),
      ),
    );
  }
}

function sendDispatcherResponse(
  state: ReaderRuntimeMessageHandlerState,
  command: Parameters<ReaderRuntimeDispatcher['handleCommand']>[0],
  response: ReaderRuntimeResponse,
): void {
  const ids = readerRuntimeCommandIds(command);
  try {
    validateRuntimeResponseEnvelope(command, response);
  } catch (error) {
    sendResponse(
      state,
      ids,
      errorResponse(
        ids,
        createProtocolError(
          'internal-error',
          'Reader runtime dispatcher returned invalid response',
          {
            details: { reason: errorMessage(error) },
          },
        ),
      ),
    );
    return;
  }
  sendResponse(state, ids, response);
}

function handleInvalidCommandMessage(
  state: ReaderRuntimeMessageHandlerState,
  parsed: Exclude<ReturnType<typeof parseReaderRuntimeCommandMessage>, { readonly ok: true }>,
): void {
  if ('ignored' in parsed) {
    logWarn(state, parsed.reason);
    return;
  }
  sendResponse(
    state,
    parsed.ids,
    errorResponse(parsed.ids, createProtocolError('bad-request', parsed.reason)),
  );
}

function sendCommandSerializationError(
  state: ReaderRuntimeMessageHandlerState,
  ids: RuntimeMessageIds,
  error: unknown,
): void {
  sendResponse(
    state,
    ids,
    errorResponse(
      ids,
      createProtocolError('bad-request', 'Reader runtime command message is not JSON-safe', {
        details: { reason: errorMessage(error) },
      }),
    ),
  );
}

function sendResponse(
  state: ReaderRuntimeMessageHandlerState,
  ids: RuntimeMessageIds,
  response: ReaderRuntimeResponse,
): void {
  let outbound = response;
  let message = responseMessage(outbound);

  try {
    assertProtocolSerializable(message);
  } catch (error) {
    outbound = errorResponse(
      ids,
      createProtocolError('internal-error', 'Reader runtime response is not JSON-safe', {
        details: { reason: errorMessage(error) },
      }),
    );
    message = responseMessage(outbound);
    try {
      assertProtocolSerializable(message);
    } catch (fallbackError) {
      logError(state, 'Reader runtime fallback response is not JSON-safe', fallbackError);
      return;
    }
  }

  try {
    state.port.postMessage(message);
  } catch (error) {
    logError(state, 'Reader runtime response postMessage failed', error);
  }
}

function responseMessage(response: ReaderRuntimeResponse): ReaderRuntimeResponseMessage {
  return { kind: 'reader-runtime-response', response };
}

function errorResponse(ids: RuntimeMessageIds, error: ReaderProtocolError): ReaderRuntimeResponse {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: ids.requestId,
    kind: 'error',
    ok: false,
    ...(ids.sessionId !== undefined ? { sessionId: ids.sessionId } : {}),
    ...(ids.revisionId !== undefined ? { revisionId: ids.revisionId } : {}),
    error,
  };
}

function disposeReaderRuntimeMessageHandler(state: ReaderRuntimeMessageHandlerState): void {
  if (state.disposed) return;
  state.disposed = true;
  try {
    state.unsubscribe();
  } catch (error) {
    logError(state, 'Reader runtime message handler unsubscribe failed', error);
  }
  if (!state.disposeDispatcher) return;
  try {
    state.dispatcher.dispose();
  } catch (error) {
    logError(state, 'Reader runtime dispatcher dispose failed', error);
  }
}

function logWarn(state: ReaderRuntimeMessageHandlerState, message: string): void {
  state.logger?.warn(message);
}

function logError(state: ReaderRuntimeMessageHandlerState, message: string, error: unknown): void {
  state.logger?.error(message, error);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
