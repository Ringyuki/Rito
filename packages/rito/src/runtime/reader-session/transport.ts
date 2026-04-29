import type { ReaderRuntimeCommand, ReaderRuntimeResponse } from './protocol';
import {
  ReaderRuntimeClientError,
  clientError,
  commandIds,
  validateRuntimeResponseEnvelope,
} from './response-validation';
import type { ReaderRuntimeRequestId } from './types';

export interface ReaderRuntimeTransport {
  post(command: ReaderRuntimeCommand): Promise<ReaderRuntimeResponse>;
  dispose(): void;
}

export interface CreateInProcessReaderRuntimeTransportInput {
  readonly handleCommand: (command: ReaderRuntimeCommand) => Promise<ReaderRuntimeResponse>;
}

interface PendingReaderRuntimeRequest {
  readonly command: ReaderRuntimeCommand;
  readonly resolve: (response: ReaderRuntimeResponse) => void;
  readonly reject: (error: ReaderRuntimeClientError) => void;
}

interface ReaderRuntimeTransportState {
  readonly handleCommand: (command: ReaderRuntimeCommand) => Promise<ReaderRuntimeResponse>;
  readonly pending: Map<ReaderRuntimeRequestId, PendingReaderRuntimeRequest>;
  disposed: boolean;
}

export function createInProcessReaderRuntimeTransport(
  input: CreateInProcessReaderRuntimeTransportInput,
): ReaderRuntimeTransport {
  const state: ReaderRuntimeTransportState = {
    handleCommand: input.handleCommand,
    pending: new Map<ReaderRuntimeRequestId, PendingReaderRuntimeRequest>(),
    disposed: false,
  };

  return {
    post(command) {
      return postReaderRuntimeCommand(state, command);
    },
    dispose() {
      disposeReaderRuntimeTransport(state);
    },
  };
}

function postReaderRuntimeCommand(
  state: ReaderRuntimeTransportState,
  command: ReaderRuntimeCommand,
): Promise<ReaderRuntimeResponse> {
  if (state.disposed) {
    return Promise.reject(transportDisposedError(command));
  }
  if (state.pending.has(command.requestId)) {
    return Promise.reject(duplicateRequestError(command));
  }
  return new Promise<ReaderRuntimeResponse>((resolve, reject) => {
    state.pending.set(command.requestId, { command, resolve, reject });
    void runReaderRuntimeCommand(state, command);
  });
}

async function runReaderRuntimeCommand(
  state: ReaderRuntimeTransportState,
  command: ReaderRuntimeCommand,
): Promise<void> {
  try {
    const response = await state.handleCommand(command);
    validateRuntimeResponseEnvelope(command, response);
    resolvePending(state, command.requestId, response);
  } catch (error) {
    rejectPending(state, command.requestId, transportError(command, error));
  }
}

function resolvePending(
  state: ReaderRuntimeTransportState,
  requestId: ReaderRuntimeRequestId,
  response: ReaderRuntimeResponse,
): void {
  const pending = state.pending.get(requestId);
  if (!pending) return;
  state.pending.delete(requestId);
  pending.resolve(response);
}

function rejectPending(
  state: ReaderRuntimeTransportState,
  requestId: ReaderRuntimeRequestId,
  error: ReaderRuntimeClientError,
): void {
  const pending = state.pending.get(requestId);
  if (!pending) return;
  state.pending.delete(requestId);
  pending.reject(error);
}

function disposeReaderRuntimeTransport(state: ReaderRuntimeTransportState): void {
  if (state.disposed) return;
  state.disposed = true;
  const pending = [...state.pending.values()];
  state.pending.clear();
  for (const request of pending) {
    request.reject(transportDisposedError(request.command));
  }
}

function transportError(command: ReaderRuntimeCommand, error: unknown): ReaderRuntimeClientError {
  if (error instanceof ReaderRuntimeClientError) return error;
  return clientError(
    'internal-error',
    'Reader runtime transport command failed',
    commandIds(command),
    {
      cause: errorMessage(error),
    },
  );
}

function transportDisposedError(command: ReaderRuntimeCommand): ReaderRuntimeClientError {
  return clientError('bad-request', 'Reader runtime transport is disposed', commandIds(command));
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
