import type { JsonValue, ReaderRuntimeCommand, ReaderRuntimeResponse } from './protocol';
import { assertProtocolSerializable } from './protocol-helpers';
import {
  ReaderRuntimeClientError,
  clientError,
  commandIds,
  validateRuntimeResponseEnvelope,
} from './response-validation';
import type { ReaderRuntimeTransport } from './transport';
import type { ReaderRuntimeRequestId } from './types';

export interface ReaderRuntimeMessagePort {
  postMessage(message: JsonValue): void;
  subscribe(listener: (message: unknown) => void): () => void;
}

export interface ReaderRuntimeCommandMessage {
  readonly kind: 'reader-runtime-command';
  readonly command: ReaderRuntimeCommand;
}

export interface ReaderRuntimeResponseMessage {
  readonly kind: 'reader-runtime-response';
  readonly response: ReaderRuntimeResponse;
}

export type ReaderRuntimeMessage = ReaderRuntimeCommandMessage | ReaderRuntimeResponseMessage;

export interface CreateReaderRuntimeMessageTransportInput {
  readonly port: ReaderRuntimeMessagePort;
}

interface PendingReaderRuntimeMessageRequest {
  readonly command: ReaderRuntimeCommand;
  readonly resolve: (response: ReaderRuntimeResponse) => void;
  readonly reject: (error: ReaderRuntimeClientError) => void;
}

interface ReaderRuntimeMessageTransportState {
  readonly port: ReaderRuntimeMessagePort;
  readonly pending: Map<ReaderRuntimeRequestId, PendingReaderRuntimeMessageRequest>;
  unsubscribe: () => void;
  subscribeFailureReason: string | undefined;
  disposed: boolean;
}

type UnknownRecord = { readonly [key: string]: unknown };

export function createReaderRuntimeMessageTransport(
  input: CreateReaderRuntimeMessageTransportInput,
): ReaderRuntimeTransport {
  const state: ReaderRuntimeMessageTransportState = {
    port: input.port,
    pending: new Map<ReaderRuntimeRequestId, PendingReaderRuntimeMessageRequest>(),
    unsubscribe: () => undefined,
    subscribeFailureReason: undefined,
    disposed: false,
  };
  try {
    state.unsubscribe = input.port.subscribe((message) => {
      handleReaderRuntimeMessage(state, message);
    });
  } catch (error) {
    state.disposed = true;
    state.subscribeFailureReason = errorMessage(error);
  }

  return {
    post(command) {
      return postReaderRuntimeMessage(state, command);
    },
    dispose() {
      disposeReaderRuntimeMessageTransport(state);
    },
  };
}

function postReaderRuntimeMessage(
  state: ReaderRuntimeMessageTransportState,
  command: ReaderRuntimeCommand,
): Promise<ReaderRuntimeResponse> {
  if (state.disposed) {
    if (state.subscribeFailureReason !== undefined) {
      return Promise.reject(subscribeMessageError(command, state.subscribeFailureReason));
    }
    return Promise.reject(messageTransportDisposedError(command));
  }
  if (state.pending.has(command.requestId)) {
    return Promise.reject(duplicateRequestError(command));
  }

  return new Promise<ReaderRuntimeResponse>((resolve, reject) => {
    state.pending.set(command.requestId, { command, resolve, reject });
    const message: ReaderRuntimeCommandMessage = { kind: 'reader-runtime-command', command };
    try {
      assertProtocolSerializable(message);
    } catch (error) {
      rejectPending(state, command.requestId, serializeMessageError(command, error));
      return;
    }
    try {
      state.port.postMessage(message);
    } catch (error) {
      rejectPending(state, command.requestId, postMessageError(command, error));
    }
  });
}

function handleReaderRuntimeMessage(
  state: ReaderRuntimeMessageTransportState,
  message: unknown,
): void {
  const requestId = responseMessageRequestId(message);
  if (requestId === undefined) return;

  const pending = state.pending.get(requestId);
  if (!pending) return;

  try {
    const responseMessage = parseResponseMessage(message);
    assertProtocolSerializable(responseMessage);
    validateRuntimeResponseEnvelope(pending.command, responseMessage.response);
    resolvePending(state, requestId, responseMessage.response);
  } catch (error) {
    rejectPending(state, requestId, receiveMessageError(pending.command, error));
  }
}

function parseResponseMessage(message: unknown): ReaderRuntimeResponseMessage {
  if (!isRecord(message) || message['kind'] !== 'reader-runtime-response') {
    throw new Error('Reader runtime message kind is invalid');
  }
  const response = message['response'];
  if (!isResponseLike(response)) {
    throw new Error('Reader runtime response message payload is invalid');
  }
  return { kind: 'reader-runtime-response', response };
}

function responseMessageRequestId(message: unknown): ReaderRuntimeRequestId | undefined {
  if (!isRecord(message) || message['kind'] !== 'reader-runtime-response') return undefined;
  const response = message['response'];
  if (!isRecord(response) || typeof response['requestId'] !== 'string') return undefined;
  return response['requestId'];
}

function isResponseLike(response: unknown): response is ReaderRuntimeResponse {
  return (
    isRecord(response) &&
    typeof response['requestId'] === 'string' &&
    typeof response['kind'] === 'string' &&
    typeof response['ok'] === 'boolean'
  );
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function resolvePending(
  state: ReaderRuntimeMessageTransportState,
  requestId: ReaderRuntimeRequestId,
  response: ReaderRuntimeResponse,
): void {
  const pending = state.pending.get(requestId);
  if (!pending) return;
  state.pending.delete(requestId);
  pending.resolve(response);
}

function rejectPending(
  state: ReaderRuntimeMessageTransportState,
  requestId: ReaderRuntimeRequestId,
  error: ReaderRuntimeClientError,
): void {
  const pending = state.pending.get(requestId);
  if (!pending) return;
  state.pending.delete(requestId);
  pending.reject(error);
}

function disposeReaderRuntimeMessageTransport(state: ReaderRuntimeMessageTransportState): void {
  if (state.disposed) return;
  state.disposed = true;
  try {
    state.unsubscribe();
  } catch {
    // The transport still owns pending request cleanup even if the port cleanup fails.
  }
  const pending = [...state.pending.values()];
  state.pending.clear();
  for (const request of pending) {
    request.reject(messageTransportDisposedError(request.command));
  }
}

function receiveMessageError(
  command: ReaderRuntimeCommand,
  error: unknown,
): ReaderRuntimeClientError {
  if (error instanceof ReaderRuntimeClientError) return error;
  return clientError(
    'bad-request',
    'Reader runtime response message is invalid',
    commandIds(command),
    { reason: errorMessage(error) },
  );
}

function serializeMessageError(
  command: ReaderRuntimeCommand,
  error: unknown,
): ReaderRuntimeClientError {
  return clientError(
    'bad-request',
    'Reader runtime command message is not JSON-safe',
    commandIds(command),
    { reason: errorMessage(error) },
  );
}

function postMessageError(command: ReaderRuntimeCommand, error: unknown): ReaderRuntimeClientError {
  return clientError(
    'internal-error',
    'Reader runtime message port failed to send command',
    commandIds(command),
    { reason: errorMessage(error) },
  );
}

function subscribeMessageError(
  command: ReaderRuntimeCommand,
  reason: string,
): ReaderRuntimeClientError {
  return clientError(
    'internal-error',
    'Reader runtime message port failed to subscribe',
    commandIds(command),
    { reason },
  );
}

function messageTransportDisposedError(command: ReaderRuntimeCommand): ReaderRuntimeClientError {
  return clientError(
    'bad-request',
    'Reader runtime message transport is disposed',
    commandIds(command),
  );
}

function duplicateRequestError(command: ReaderRuntimeCommand): ReaderRuntimeClientError {
  return clientError(
    'bad-request',
    'Reader runtime requestId is already pending',
    commandIds(command),
  );
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
