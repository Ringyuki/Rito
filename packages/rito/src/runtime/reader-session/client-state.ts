import type {
  CancelRevisionCommand,
  GetFootnoteCommand,
  GetResourceCommand,
  GetSpreadFrameCommand,
  PrefetchCommand,
  ReaderRuntimeCommand,
  ReaderRuntimeResponse,
  ResolveLocatorGeometryCommand,
  ResolveLocatorCommand,
  SearchCommand,
} from './protocol';
import { isCurrentRevisionResponse } from './protocol-helpers';
import { clientError, staleResponseError, validateResponseEnvelope } from './response-validation';
import type { ReaderRuntimeClientState } from './client-types';
import type { ReaderRevisionId, ReaderRuntimeRequestId, ReaderSessionId } from './types';

export type RevisionScopedClientCommand =
  | CancelRevisionCommand
  | ResolveLocatorCommand
  | ResolveLocatorGeometryCommand
  | GetSpreadFrameCommand
  | GetFootnoteCommand
  | GetResourceCommand
  | PrefetchCommand
  | SearchCommand;

export async function dispatchRevisionCommand(
  state: ReaderRuntimeClientState,
  command: RevisionScopedClientCommand,
): Promise<ReaderRuntimeResponse> {
  const response = await dispatchCommand(state, command);
  validateResponseEnvelope(command, response);
  if (!state.activeRevisionId || !isCurrentRevisionResponse(response, state.activeRevisionId)) {
    throw staleResponseError(command, response.revisionId);
  }
  return response;
}

export async function dispatchCommand(
  state: ReaderRuntimeClientState,
  command: ReaderRuntimeCommand,
): Promise<ReaderRuntimeResponse> {
  try {
    return await state.dispatch(command);
  } catch (error) {
    throw clientError('internal-error', 'Reader runtime dispatch failed', command, {
      cause: errorMessage(error),
    });
  }
}

export function assertCanOpen(state: ReaderRuntimeClientState): void {
  if (state.closed) throw clientError('bad-request', 'Reader runtime client is closed');
  if (state.sessionId !== undefined || state.openingRequestId !== undefined) {
    throw clientError('bad-request', 'Reader runtime client already has an open session');
  }
}

export function requireSession(state: ReaderRuntimeClientState): ReaderSessionId {
  if (state.closed) throw clientError('bad-request', 'Reader runtime client is closed');
  if (state.sessionId === undefined) {
    throw clientError('bad-request', 'Reader runtime client is not open');
  }
  return state.sessionId;
}

export function requireActiveRevision(state: ReaderRuntimeClientState): ReaderRevisionId {
  if (state.activeRevisionId === undefined) {
    throw clientError('bad-request', 'Reader runtime client has no active revision');
  }
  return state.activeRevisionId;
}

export function closeLocalState(state: ReaderRuntimeClientState): void {
  state.closed = true;
  state.sessionId = undefined;
  state.activeRevisionId = undefined;
  state.openingRequestId = undefined;
  state.latestCreateRevisionRequestId = undefined;
}

export function nextRequestId(state: ReaderRuntimeClientState): ReaderRuntimeRequestId {
  return state.createRequestId();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
