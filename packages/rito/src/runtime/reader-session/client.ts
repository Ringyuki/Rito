import {
  cancelRevisionCommand,
  closeSessionCommand,
  createRevisionCommand,
  getFootnoteCommand,
  createSequentialRequestId,
  getResourceCommand,
  getSpreadFrameCommand,
  openSessionCommand,
  prefetchCommand,
  resolveLocatorCommand,
  resolveLocatorGeometryCommand,
  searchCommand,
} from './client-commands';
import {
  expectSuccessResponse,
  staleResponseError,
  validateResponseEnvelope,
  validateRevisionPayload,
} from './response-validation';
import type {
  ReaderLayoutRequest,
  ReaderFootnotePayload,
  PrefetchRequest,
  ReaderPublication,
  ReaderResourcePayload,
  ReaderRevision,
  SearchBatch,
  SearchRequest,
  ReaderSpreadFrame,
  ResolvedLocator,
  ResolvedLocatorGeometry,
  ResolveLocatorRequest,
  ResolveLocatorGeometryRequest,
  ResourceRequest,
  FootnoteRequest,
  SpreadFrameRequest,
} from './types';
import type {
  CreateReaderRuntimeClientInput,
  ReaderRuntimeClient,
  ReaderRuntimeClientState,
} from './client-types';
import {
  assertCanOpen,
  closeLocalState,
  dispatchCommand,
  dispatchRevisionCommand,
  nextRequestId,
  requireActiveRevision,
  requireSession,
} from './client-state';

export { ReaderRuntimeClientError } from './response-validation';
export type {
  CreateReaderRuntimeClientInput,
  DispatchReaderRuntimeCommand,
  ReaderRuntimeClient,
} from './client-types';

export function createReaderRuntimeClient(
  input: CreateReaderRuntimeClientInput,
): ReaderRuntimeClient {
  const state: ReaderRuntimeClientState = {
    dispatch: input.dispatch,
    createRequestId: input.createRequestId ?? createSequentialRequestId(),
    sessionId: undefined,
    activeRevisionId: undefined,
    openingRequestId: undefined,
    latestCreateRevisionRequestId: undefined,
    closed: false,
  };

  return {
    get sessionId() {
      return state.sessionId;
    },
    get activeRevisionId() {
      return state.activeRevisionId;
    },
    openSession: (publicationRef) => openClientSession(state, publicationRef),
    createRevision: (request) => createClientRevision(state, request),
    cancelRevision: () => cancelClientRevision(state),
    resolveLocator: (request) => resolveClientLocator(state, request),
    resolveLocatorGeometry: (request) => resolveClientLocatorGeometry(state, request),
    getSpreadFrame: (request) => getClientSpreadFrame(state, request),
    getFootnote: (request) => getClientFootnote(state, request),
    getResource: (request) => getClientResource(state, request),
    prefetch: (request) => prefetchClientSpreads(state, request),
    search: (request) => searchClientText(state, request),
    close: () => closeClientSession(state),
  };
}

async function openClientSession(
  state: ReaderRuntimeClientState,
  publicationRef: string,
): Promise<ReaderPublication> {
  assertCanOpen(state);
  const command = openSessionCommand(nextRequestId(state), publicationRef);
  state.openingRequestId = command.requestId;
  try {
    const response = await dispatchCommand(state, command);
    validateResponseEnvelope(command, response);
    const success = expectSuccessResponse(response, 'openSession');
    state.sessionId = success.sessionId;
    return success.payload.publication;
  } finally {
    if (state.openingRequestId === command.requestId) {
      state.openingRequestId = undefined;
    }
  }
}

async function createClientRevision(
  state: ReaderRuntimeClientState,
  request: ReaderLayoutRequest,
): Promise<ReaderRevision> {
  const sessionId = requireSession(state);
  const command = createRevisionCommand(nextRequestId(state), sessionId, request);
  state.latestCreateRevisionRequestId = command.requestId;
  const response = await dispatchCommand(state, command);
  validateResponseEnvelope(command, response);
  const success = expectSuccessResponse(response, 'createRevision');
  if (state.latestCreateRevisionRequestId !== command.requestId) {
    throw staleResponseError(command, success.revisionId);
  }
  validateRevisionPayload(
    success.payload.revision,
    success.revisionId,
    sessionId,
    command.requestId,
  );
  state.activeRevisionId = success.revisionId;
  return success.payload.revision;
}

async function cancelClientRevision(state: ReaderRuntimeClientState): Promise<void> {
  const sessionId = requireSession(state);
  const revisionId = requireActiveRevision(state);
  const command = cancelRevisionCommand(nextRequestId(state), sessionId, revisionId);
  const response = await dispatchRevisionCommand(state, command);
  expectSuccessResponse(response, 'cancelRevision');
  if (state.activeRevisionId === revisionId) state.activeRevisionId = undefined;
}

async function resolveClientLocator(
  state: ReaderRuntimeClientState,
  request: ResolveLocatorRequest,
): Promise<ResolvedLocator> {
  const sessionId = requireSession(state);
  const revisionId = requireActiveRevision(state);
  const command = resolveLocatorCommand(nextRequestId(state), sessionId, revisionId, request);
  const response = await dispatchRevisionCommand(state, command);
  return expectSuccessResponse(response, 'resolveLocator').payload;
}

async function resolveClientLocatorGeometry(
  state: ReaderRuntimeClientState,
  request: ResolveLocatorGeometryRequest,
): Promise<ResolvedLocatorGeometry> {
  const sessionId = requireSession(state);
  const revisionId = requireActiveRevision(state);
  const command = resolveLocatorGeometryCommand(
    nextRequestId(state),
    sessionId,
    revisionId,
    request,
  );
  const response = await dispatchRevisionCommand(state, command);
  return expectSuccessResponse(response, 'resolveLocatorGeometry').payload;
}

async function getClientSpreadFrame(
  state: ReaderRuntimeClientState,
  request: SpreadFrameRequest,
): Promise<ReaderSpreadFrame> {
  const sessionId = requireSession(state);
  const revisionId = requireActiveRevision(state);
  const command = getSpreadFrameCommand(nextRequestId(state), sessionId, revisionId, request);
  const response = await dispatchRevisionCommand(state, command);
  return expectSuccessResponse(response, 'getSpreadFrame').payload.frame;
}

async function getClientResource(
  state: ReaderRuntimeClientState,
  request: ResourceRequest,
): Promise<ReaderResourcePayload> {
  const sessionId = requireSession(state);
  const revisionId = requireActiveRevision(state);
  const command = getResourceCommand(nextRequestId(state), sessionId, revisionId, request);
  const response = await dispatchRevisionCommand(state, command);
  return expectSuccessResponse(response, 'getResource').payload;
}

async function getClientFootnote(
  state: ReaderRuntimeClientState,
  request: FootnoteRequest,
): Promise<ReaderFootnotePayload> {
  const sessionId = requireSession(state);
  const revisionId = requireActiveRevision(state);
  const command = getFootnoteCommand(nextRequestId(state), sessionId, revisionId, request);
  const response = await dispatchRevisionCommand(state, command);
  return expectSuccessResponse(response, 'getFootnote').payload;
}

async function prefetchClientSpreads(
  state: ReaderRuntimeClientState,
  request: PrefetchRequest,
): Promise<readonly number[]> {
  const sessionId = requireSession(state);
  const revisionId = requireActiveRevision(state);
  const command = prefetchCommand(nextRequestId(state), sessionId, revisionId, request);
  const response = await dispatchRevisionCommand(state, command);
  return expectSuccessResponse(response, 'prefetch').payload.spreadIndexes;
}

async function searchClientText(
  state: ReaderRuntimeClientState,
  request: SearchRequest,
): Promise<SearchBatch> {
  const sessionId = requireSession(state);
  const revisionId = requireActiveRevision(state);
  const command = searchCommand(nextRequestId(state), sessionId, revisionId, request);
  const response = await dispatchRevisionCommand(state, command);
  return expectSuccessResponse(response, 'search').payload;
}

async function closeClientSession(state: ReaderRuntimeClientState): Promise<void> {
  const sessionId = requireSession(state);
  const command = closeSessionCommand(nextRequestId(state), sessionId);
  closeLocalState(state);
  const response = await dispatchCommand(state, command);
  validateResponseEnvelope(command, response);
  if (!response.ok && response.error.code === 'not-found') return;
  expectSuccessResponse(response, 'closeSession');
}
