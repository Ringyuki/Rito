import type { EpubDocument } from '../types';
import type { ReaderSessionError } from './errors';
import type {
  OpenSessionResponse,
  ReaderProtocolError,
  ReaderRuntimeCommand,
  ReaderRuntimeErrorResponse,
} from './protocol';
import { READER_RUNTIME_PROTOCOL_VERSION } from './protocol';
import { createProtocolError } from './protocol-helpers';
import type { ReaderPublication, ReaderRevisionId, ReaderSessionId } from './types';

export function openSessionSuccess(
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'openSession' }>,
  sessionId: ReaderSessionId,
  publication: ReaderPublication,
): OpenSessionResponse {
  return {
    ...openSessionEnvelope(command, sessionId),
    kind: 'openSession',
    ok: true,
    payload: { publication },
  };
}

export function failure(
  command: ReaderRuntimeCommand,
  error: ReaderProtocolError,
  ids?: { readonly sessionId?: ReaderSessionId; readonly revisionId?: ReaderRevisionId },
): ReaderRuntimeErrorResponse {
  return {
    ...base(command, ids),
    kind: 'error',
    ok: false,
    error,
  };
}

export function unknownSession(command: ReaderRuntimeCommand): ReaderRuntimeErrorResponse {
  return failure(command, createProtocolError('not-found', 'Reader session is not known'));
}

export function sessionEnvelope(
  command: ReaderRuntimeCommand & { readonly sessionId: ReaderSessionId },
): {
  readonly protocolVersion: typeof READER_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly sessionId: ReaderSessionId;
} {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: command.requestId,
    sessionId: command.sessionId,
  };
}

export function revisionEnvelope(
  command: ReaderRuntimeCommand & {
    readonly sessionId: ReaderSessionId;
    readonly revisionId: ReaderRevisionId;
  },
): {
  readonly protocolVersion: typeof READER_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
} {
  return {
    ...sessionEnvelope(command),
    revisionId: command.revisionId,
  };
}

export function toProtocolError(error: unknown): ReaderProtocolError {
  if (isReaderSessionError(error)) return error.protocolError;
  return createProtocolError('internal-error', 'Reader runtime command failed', {
    details: { cause: errorMessage(error) },
  });
}

export function publicationFromDocument(document: EpubDocument): ReaderPublication {
  const { metadata, spine } = document.packageDocument;
  return {
    metadata,
    spineItemCount: spine.length,
  };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function base(
  command: ReaderRuntimeCommand,
  ids?: { readonly sessionId?: ReaderSessionId; readonly revisionId?: ReaderRevisionId },
): {
  readonly protocolVersion: typeof READER_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly sessionId?: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
} {
  const sessionId = ids?.sessionId ?? command.sessionId;
  const revisionId = ids?.revisionId ?? command.revisionId;
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: command.requestId,
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(revisionId !== undefined ? { revisionId } : {}),
  };
}

function openSessionEnvelope(
  command: Extract<ReaderRuntimeCommand, { readonly kind: 'openSession' }>,
  sessionId: ReaderSessionId,
): {
  readonly protocolVersion: typeof READER_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly sessionId: ReaderSessionId;
} {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId: command.requestId,
    sessionId,
  };
}

function isReaderSessionError(error: unknown): error is ReaderSessionError {
  return error instanceof Error && error.name === 'ReaderSessionError' && 'protocolError' in error;
}
