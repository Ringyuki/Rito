import type {
  CancelRevisionCommand,
  CloseSessionCommand,
  CreateRevisionCommand,
  GetFootnoteCommand,
  GetResourceCommand,
  GetSpreadFrameCommand,
  OpenSessionCommand,
  PrefetchCommand,
  ResolveLocatorGeometryCommand,
  ResolveLocatorCommand,
  SearchCommand,
} from './protocol';
import { READER_RUNTIME_PROTOCOL_VERSION } from './protocol';
import type {
  ReaderLayoutRequest,
  ReaderRevisionId,
  ReaderRuntimeRequestId,
  ReaderSessionId,
  FootnoteRequest,
  PrefetchRequest,
  ResolveLocatorGeometryRequest,
  ResolveLocatorRequest,
  ResourceRequest,
  SearchRequest,
  SpreadFrameRequest,
} from './types';

export function openSessionCommand(
  requestId: ReaderRuntimeRequestId,
  publicationRef: string,
): OpenSessionCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'openSession',
    payload: { publicationRef },
  };
}

export function createRevisionCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
  payload: ReaderLayoutRequest,
): CreateRevisionCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'createRevision',
    sessionId,
    payload,
  };
}

export function cancelRevisionCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
): CancelRevisionCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'cancelRevision',
    sessionId,
    revisionId,
  };
}

export function resolveLocatorCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
  payload: ResolveLocatorRequest,
): ResolveLocatorCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'resolveLocator',
    sessionId,
    revisionId,
    payload,
  };
}

export function resolveLocatorGeometryCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
  payload: ResolveLocatorGeometryRequest,
): ResolveLocatorGeometryCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'resolveLocatorGeometry',
    sessionId,
    revisionId,
    payload,
  };
}

export function getSpreadFrameCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
  payload: SpreadFrameRequest,
): GetSpreadFrameCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'getSpreadFrame',
    sessionId,
    revisionId,
    payload,
  };
}

export function getResourceCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
  payload: ResourceRequest,
): GetResourceCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'getResource',
    sessionId,
    revisionId,
    payload,
  };
}

export function getFootnoteCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
  payload: FootnoteRequest,
): GetFootnoteCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'getFootnote',
    sessionId,
    revisionId,
    payload,
  };
}

export function prefetchCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
  payload: PrefetchRequest,
): PrefetchCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'prefetch',
    sessionId,
    revisionId,
    payload,
  };
}

export function searchCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
  revisionId: ReaderRevisionId,
  payload: SearchRequest,
): SearchCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'search',
    sessionId,
    revisionId,
    payload,
  };
}

export function closeSessionCommand(
  requestId: ReaderRuntimeRequestId,
  sessionId: ReaderSessionId,
): CloseSessionCommand {
  return {
    protocolVersion: READER_RUNTIME_PROTOCOL_VERSION,
    requestId,
    kind: 'closeSession',
    sessionId,
  };
}

export function createSequentialRequestId(): () => ReaderRuntimeRequestId {
  let next = 1;
  return () => `request-${String(next++)}`;
}
