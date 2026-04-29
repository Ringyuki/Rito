import type { ReaderProtocolError, ReaderProtocolErrorCode } from './protocol';
import { createProtocolError } from './protocol-helpers';
import type { ReaderRevisionId, ReaderSessionId } from './types';

export class ReaderSessionError extends Error {
  readonly protocolError: ReaderProtocolError;
  readonly sessionId: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;

  constructor(
    protocolError: ReaderProtocolError,
    sessionId: ReaderSessionId,
    revisionId?: ReaderRevisionId,
  ) {
    super(protocolError.message);
    this.name = 'ReaderSessionError';
    this.protocolError = protocolError;
    this.sessionId = sessionId;
    if (revisionId !== undefined) this.revisionId = revisionId;
  }
}

export function createReaderSessionError(
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId | undefined,
  code: ReaderProtocolErrorCode,
  message: string,
): ReaderSessionError {
  return new ReaderSessionError(createProtocolError(code, message), sessionId, revisionId);
}

export function createReaderSessionProtocolError(
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
  protocolError: ReaderProtocolError,
): ReaderSessionError {
  return new ReaderSessionError(protocolError, sessionId, revisionId);
}
