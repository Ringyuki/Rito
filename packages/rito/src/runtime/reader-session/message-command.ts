import type { ReaderRuntimeCommand } from './protocol';
import type { ReaderRevisionId, ReaderRuntimeRequestId, ReaderSessionId } from './types';
import { commandShapeError } from './message-command-shapes';

export interface RuntimeMessageIds {
  readonly requestId: ReaderRuntimeRequestId;
  readonly sessionId?: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
}

export type ParseCommandMessageResult =
  | { readonly ok: true; readonly command: ReaderRuntimeCommand }
  | { readonly ok: false; readonly ids: RuntimeMessageIds; readonly reason: string }
  | { readonly ok: false; readonly ignored: true; readonly reason: string };

type UnknownRecord = { readonly [key: string]: unknown };

const COMMAND_KINDS: ReadonlySet<string> = new Set([
  'openSession',
  'createRevision',
  'cancelRevision',
  'resolveLocator',
  'resolveLocatorGeometry',
  'getSpreadFrame',
  'prefetch',
  'search',
  'getFootnote',
  'getResource',
  'closeSession',
]);

export function parseReaderRuntimeCommandMessage(message: unknown): ParseCommandMessageResult {
  if (!isRecord(message)) {
    return ignoredCommand('Reader runtime message must be an object');
  }
  if (message['kind'] !== 'reader-runtime-command') {
    return ignoredCommand('Reader runtime message kind is not a command');
  }

  const command = message['command'];
  if (!isRecord(command)) {
    return ignoredCommand('Reader runtime command payload must be an object');
  }

  const ids = extractCommandIds(command);
  if (ids === undefined) {
    return ignoredCommand('Reader runtime command requestId is missing or invalid');
  }

  const invalidIdReason = invalidOptionalIdReason(command);
  if (invalidIdReason !== undefined) {
    return invalidCommand(ids, invalidIdReason);
  }

  const kind = command['kind'];
  if (typeof kind !== 'string' || !COMMAND_KINDS.has(kind)) {
    return invalidCommand(ids, 'Reader runtime command kind is invalid');
  }

  const shapeError = commandShapeError(command, kind);
  if (shapeError !== undefined) {
    return invalidCommand(ids, shapeError);
  }

  return { ok: true, command: command as unknown as ReaderRuntimeCommand };
}

export function readerRuntimeCommandIds(command: ReaderRuntimeCommand): RuntimeMessageIds {
  return {
    requestId: command.requestId,
    ...(command.sessionId !== undefined ? { sessionId: command.sessionId } : {}),
    ...(command.revisionId !== undefined ? { revisionId: command.revisionId } : {}),
  };
}

function invalidOptionalIdReason(command: UnknownRecord): string | undefined {
  if (command['sessionId'] !== undefined && !isNonEmptyString(command['sessionId'])) {
    return 'Reader runtime command sessionId is invalid';
  }
  if (command['revisionId'] !== undefined && !isNonEmptyString(command['revisionId'])) {
    return 'Reader runtime command revisionId is invalid';
  }
  return undefined;
}

function extractCommandIds(command: UnknownRecord): RuntimeMessageIds | undefined {
  if (!isNonEmptyString(command['requestId'])) return undefined;
  return {
    requestId: command['requestId'],
    ...(isNonEmptyString(command['sessionId']) ? { sessionId: command['sessionId'] } : {}),
    ...(isNonEmptyString(command['revisionId']) ? { revisionId: command['revisionId'] } : {}),
  };
}

function ignoredCommand(reason: string): ParseCommandMessageResult {
  return { ok: false, ignored: true, reason };
}

function invalidCommand(ids: RuntimeMessageIds, reason: string): ParseCommandMessageResult {
  return { ok: false, ids, reason };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}
