import type {
  ReaderProtocolError,
  ReaderRuntimeCommand,
  ReaderRuntimeResponse,
  ReaderRuntimeSuccessResponse,
} from './protocol';
import { READER_RUNTIME_PROTOCOL_VERSION } from './protocol';
import { createProtocolError } from './protocol-helpers';
import type {
  ReaderRevision,
  ReaderRevisionId,
  ReaderRuntimeRequestId,
  ReaderSessionId,
} from './types';

export class ReaderRuntimeClientError extends Error {
  readonly protocolError: ReaderProtocolError;
  readonly requestId: ReaderRuntimeRequestId | undefined;
  readonly sessionId: ReaderSessionId | undefined;
  readonly revisionId: ReaderRevisionId | undefined;

  constructor(
    protocolError: ReaderProtocolError,
    ids?: {
      readonly requestId?: ReaderRuntimeRequestId;
      readonly sessionId?: ReaderSessionId;
      readonly revisionId?: ReaderRevisionId;
    },
  ) {
    super(protocolError.message);
    this.name = 'ReaderRuntimeClientError';
    this.protocolError = protocolError;
    this.requestId = ids?.requestId;
    this.sessionId = ids?.sessionId;
    this.revisionId = ids?.revisionId;
  }
}

export function expectSuccessResponse<K extends ReaderRuntimeSuccessResponse['kind']>(
  response: ReaderRuntimeResponse,
  kind: K,
): Extract<ReaderRuntimeSuccessResponse, { readonly kind: K }> {
  if (!response.ok) {
    throw new ReaderRuntimeClientError(response.error, responseIds(response));
  }
  if (response.kind !== kind) {
    throw malformedResponseError(response, `Expected ${kind} response`);
  }
  validateSuccessEnvelope(response);
  return response as Extract<ReaderRuntimeSuccessResponse, { readonly kind: K }>;
}

export function validateResponseEnvelope(
  command: ReaderRuntimeCommand,
  response: ReaderRuntimeResponse,
): void {
  const protocolVersion = runtimeProtocolVersion(response);
  if (protocolVersion !== READER_RUNTIME_PROTOCOL_VERSION) {
    throw malformedResponseError(response, 'Unsupported response protocol version');
  }
  if (response.requestId !== command.requestId) {
    throw malformedResponseError(response, 'Response requestId does not match command requestId');
  }
  if (command.sessionId !== undefined && response.sessionId !== command.sessionId) {
    throw malformedResponseError(response, 'Response sessionId does not match command sessionId');
  }
  if (command.revisionId !== undefined && response.revisionId !== command.revisionId) {
    throw malformedResponseError(response, 'Response revisionId does not match command revisionId');
  }
}

export function validateRuntimeResponseEnvelope(
  command: ReaderRuntimeCommand,
  response: ReaderRuntimeResponse,
): void {
  validateResponseEnvelope(command, response);
  if (response.ok) validateSuccessEnvelope(response);
}

export function validateRevisionPayload(
  revision: ReaderRevision,
  revisionId: ReaderRevisionId,
  sessionId: ReaderSessionId,
  requestId: ReaderRuntimeRequestId,
): void {
  if (revision.id === revisionId && revision.sessionId === sessionId) return;
  throw clientError('bad-request', 'Create revision payload does not match response envelope', {
    requestId,
    sessionId,
    revisionId,
  });
}

export function malformedResponseError(
  response: ReaderRuntimeResponse,
  reason: string,
): ReaderRuntimeClientError {
  return clientError(
    'bad-request',
    'Reader runtime response envelope is invalid',
    responseIds(response),
    { reason },
  );
}

export function staleResponseError(
  command: ReaderRuntimeCommand,
  revisionId: ReaderRevisionId | undefined,
): ReaderRuntimeClientError {
  return clientError('stale-revision', 'Reader runtime response is stale', {
    requestId: command.requestId,
    ...(command.sessionId !== undefined ? { sessionId: command.sessionId } : {}),
    ...(revisionId !== undefined ? { revisionId } : {}),
  });
}

export function clientError(
  code: ReaderProtocolError['code'],
  message: string,
  ids?: {
    readonly requestId?: ReaderRuntimeRequestId;
    readonly sessionId?: ReaderSessionId;
    readonly revisionId?: ReaderRevisionId;
  },
  details?: { readonly [key: string]: string },
): ReaderRuntimeClientError {
  return new ReaderRuntimeClientError(
    createProtocolError(code, message, details !== undefined ? { details } : undefined),
    ids,
  );
}

export function commandIds(command: ReaderRuntimeCommand): {
  readonly requestId: ReaderRuntimeRequestId;
  readonly sessionId?: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
} {
  return {
    requestId: command.requestId,
    ...(command.sessionId !== undefined ? { sessionId: command.sessionId } : {}),
    ...(command.revisionId !== undefined ? { revisionId: command.revisionId } : {}),
  };
}

function responseIds(response: ReaderRuntimeResponse): {
  readonly requestId?: ReaderRuntimeRequestId;
  readonly sessionId?: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
} {
  return {
    requestId: response.requestId,
    ...(response.sessionId !== undefined ? { sessionId: response.sessionId } : {}),
    ...(response.revisionId !== undefined ? { revisionId: response.revisionId } : {}),
  };
}

function runtimeProtocolVersion(response: ReaderRuntimeResponse): unknown {
  return (response as { readonly protocolVersion?: unknown }).protocolVersion;
}

function validateSuccessEnvelope(response: ReaderRuntimeSuccessResponse): void {
  if (response.kind === 'openSession') {
    validateSessionId(response);
    return;
  }
  if (response.kind === 'closeSession') {
    validateSessionId(response);
    return;
  }
  validateSessionId(response);
  validateRevisionId(response);
  validateRevisionScopedPayload(response);
}

function validateSessionId(response: ReaderRuntimeSuccessResponse): void {
  if (!isValidRuntimeId(runtimeSessionId(response))) {
    throw malformedResponseError(response, 'Success response has invalid sessionId');
  }
}

function validateRevisionId(response: ReaderRuntimeSuccessResponse): void {
  if (!isValidRuntimeId(runtimeRevisionId(response))) {
    throw malformedResponseError(
      response,
      'Revision-scoped success response has invalid revisionId',
    );
  }
}

function isValidRuntimeId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function runtimeSessionId(response: ReaderRuntimeResponse): unknown {
  return (response as { readonly sessionId?: unknown }).sessionId;
}

function runtimeRevisionId(response: ReaderRuntimeResponse): unknown {
  return (response as { readonly revisionId?: unknown }).revisionId;
}

function validateRevisionScopedPayload(response: ReaderRuntimeSuccessResponse): void {
  const revisionId = (response.payload as { readonly revisionId?: unknown }).revisionId;
  if (response.kind === 'search' && revisionId !== undefined) {
    throw malformedResponseError(response, 'Search payload must not duplicate revisionId');
  }
  if (response.kind === 'search' || revisionId === undefined) return;
  if (revisionId !== runtimeRevisionId(response)) {
    throw malformedResponseError(response, 'Payload revisionId does not match response envelope');
  }
}
