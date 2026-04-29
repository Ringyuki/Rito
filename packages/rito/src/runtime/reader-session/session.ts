import { buildManifestHrefMap } from '../footnote-extractor';
import { buildReaderSpreadFrame } from './frame';
import { assertReaderSessionOpen } from './lifecycle';
import { cancelReaderRevisionRecord, type ReaderRevisionRecord } from './revision';
import type { ReleaseReaderResourceTransfers, StoreReaderResourceTransfer } from './resource';
import { getReaderSessionResource, releaseSessionResourceTransfers } from './session-resource';
import { getReaderSessionFootnote } from './session-footnote';
import { buildManifestMediaTypeMap, searchReaderSessionText } from './session-search';
import {
  resolveReaderSessionLocator,
  resolveReaderSessionLocatorGeometry,
} from './session-locator';
import type {
  ReaderLayoutRequest,
  ReaderResourcePayload,
  ReaderRevision,
  ReaderRevisionId,
  ReaderSpreadFrame,
} from './types';
import type {
  BuildReaderSessionFrame,
  CreateReaderRevisionId,
  CreateReaderSessionInput,
  ReaderSession,
  ReaderSessionPrefetchRequest,
  ReaderSessionResourceRequest,
  ReaderSessionResolveLocatorGeometryRequest,
  ReaderSessionResolveLocatorRequest,
  ReaderSessionSpreadFrameRequest,
} from './session-types';
import { getReaderSessionSpreadFrame, prefetchReaderSessionSpreads } from './session-frame';
import { createReaderSessionRevision } from './session-revision';

export { ReaderSessionError } from './errors';
export type {
  BuildReaderSessionFrame,
  CreateReaderRevisionId,
  CreateReaderSessionInput,
  RegisterReaderSessionFonts,
  ReaderSession,
  ReaderSessionFootnoteRequest,
  ReaderSessionPrefetchRequest,
  ReaderSessionResourceRequest,
  ReaderSessionResolveLocatorGeometryRequest,
  ReaderSessionResolveLocatorRequest,
  ReaderSessionSpreadFrameRequest,
} from './session-types';

interface ReaderSessionState {
  readonly input: CreateReaderSessionInput;
  readonly revisions: Map<ReaderRevisionId, ReaderRevisionRecord>;
  readonly buildFrame: BuildReaderSessionFrame;
  readonly manifestHrefs: ReadonlyMap<string, string>;
  readonly manifestMediaTypes: ReadonlyMap<string, string>;
  readonly storeResourceTransfer?: StoreReaderResourceTransfer;
  readonly releaseResourceTransfers?: ReleaseReaderResourceTransfers;
  readonly now: () => number;
  readonly createRevisionId: CreateReaderRevisionId;
  fontRegistration?: Promise<void>;
  disposed: boolean;
}

export function createReaderSession(input: CreateReaderSessionInput): ReaderSession {
  const state = createReaderSessionState(input);
  return createReaderSessionApi(state);
}

function createReaderSessionState(input: CreateReaderSessionInput): ReaderSessionState {
  return {
    input,
    revisions: new Map<ReaderRevisionId, ReaderRevisionRecord>(),
    buildFrame: input.buildFrame ?? buildReaderSpreadFrame,
    manifestHrefs: buildManifestHrefMap(
      input.document.packageDocument.manifest,
      input.document.packageDocument.spine,
    ),
    manifestMediaTypes: buildManifestMediaTypeMap(input.document.packageDocument.manifest),
    ...(input.storeResourceTransfer !== undefined
      ? { storeResourceTransfer: input.storeResourceTransfer }
      : {}),
    ...(input.releaseResourceTransfers !== undefined
      ? { releaseResourceTransfers: input.releaseResourceTransfers }
      : {}),
    now: input.now ?? Date.now,
    createRevisionId: input.createRevisionId ?? createSequentialRevisionId(),
    disposed: false,
  };
}

function createReaderSessionApi(state: ReaderSessionState): ReaderSession {
  return {
    id: state.input.sessionId,
    createRevision: (request) => createSessionRevision(state, request),
    getRevision: (revisionId) => getSessionRevision(state, revisionId),
    cancelRevision: (revisionId) => {
      cancelSessionRevision(state, revisionId);
    },
    resolveLocator: (request) => resolveSessionLocator(state, request),
    resolveLocatorGeometry: (request) => resolveSessionLocatorGeometry(state, request),
    getResource: (request) => getSessionResource(state, request),
    getFootnote: (request) =>
      getReaderSessionFootnote({
        sessionId: state.input.sessionId,
        isDisposed: () => state.disposed,
        revisions: state.revisions,
        request,
      }),
    getSpreadFrame: (request) => getSessionSpreadFrame(state, request),
    prefetch: (request) => prefetchSessionSpreads(state, request),
    search: (request) =>
      searchReaderSessionText({
        sessionId: state.input.sessionId,
        isDisposed: () => state.disposed,
        revisions: state.revisions,
        request,
        spine: state.input.document.packageDocument.spine,
        manifestHrefs: state.manifestHrefs,
        manifestMediaTypes: state.manifestMediaTypes,
      }),
    dispose: () => {
      disposeSession(state);
    },
  };
}

function resolveSessionLocator(
  state: ReaderSessionState,
  request: ReaderSessionResolveLocatorRequest,
) {
  return resolveReaderSessionLocator({
    sessionId: state.input.sessionId,
    isDisposed: () => state.disposed,
    revisions: state.revisions,
    request,
    spine: state.input.document.packageDocument.spine,
    manifestHrefs: state.manifestHrefs,
  });
}

function resolveSessionLocatorGeometry(
  state: ReaderSessionState,
  request: ReaderSessionResolveLocatorGeometryRequest,
) {
  return resolveReaderSessionLocatorGeometry({
    sessionId: state.input.sessionId,
    isDisposed: () => state.disposed,
    revisions: state.revisions,
    request,
    spine: state.input.document.packageDocument.spine,
    manifestHrefs: state.manifestHrefs,
    measurer: state.input.measurer,
  });
}

function createSessionRevision(
  state: ReaderSessionState,
  request: ReaderLayoutRequest,
): ReturnType<typeof createReaderSessionRevision> {
  return createReaderSessionRevision(
    {
      sessionId: state.input.sessionId,
      document: state.input.document,
      measurer: state.input.measurer,
      revisions: state.revisions,
      now: state.now,
      createRevisionId: state.createRevisionId,
      isDisposed: () => state.disposed,
      getFontRegistration: () => state.fontRegistration,
      setFontRegistration: (registration) => {
        state.fontRegistration = registration;
      },
      ...(state.input.images !== undefined ? { images: state.input.images } : {}),
      ...(state.input.logger !== undefined ? { logger: state.input.logger } : {}),
      ...(state.input.paginateRevision !== undefined
        ? { paginateRevision: state.input.paginateRevision }
        : {}),
      ...(state.input.registerFonts !== undefined
        ? { registerFonts: state.input.registerFonts }
        : {}),
    },
    request,
  );
}

function getSessionRevision(
  state: ReaderSessionState,
  revisionId: ReaderRevisionId,
): ReaderRevision | undefined {
  assertReaderSessionOpen(state.disposed, state.input.sessionId, revisionId);
  return state.revisions.get(revisionId)?.revision;
}

function cancelSessionRevision(state: ReaderSessionState, revisionId: ReaderRevisionId): void {
  assertReaderSessionOpen(state.disposed, state.input.sessionId, revisionId);
  const record = state.revisions.get(revisionId);
  if (!record) return;
  state.revisions.set(revisionId, cancelReaderRevisionRecord(record));
  releaseResourceTransfers(state, revisionId);
}

function getSessionResource(
  state: ReaderSessionState,
  request: ReaderSessionResourceRequest,
): Promise<ReaderResourcePayload> {
  return getReaderSessionResource({
    sessionId: state.input.sessionId,
    isDisposed: () => state.disposed,
    revisions: state.revisions,
    revisionId: request.revisionId,
    document: state.input.document,
    resource: request.resource,
    ...(state.storeResourceTransfer !== undefined
      ? { storeResourceTransfer: state.storeResourceTransfer }
      : {}),
  });
}

function getSessionSpreadFrame(
  state: ReaderSessionState,
  request: ReaderSessionSpreadFrameRequest,
): Promise<ReaderSpreadFrame> {
  return getReaderSessionSpreadFrame({
    sessionId: state.input.sessionId,
    isDisposed: () => state.disposed,
    revisions: state.revisions,
    frameSource: { ...state.input, manifestHrefs: state.manifestHrefs },
    buildFrame: state.buildFrame,
    request,
  });
}

function prefetchSessionSpreads(
  state: ReaderSessionState,
  request: ReaderSessionPrefetchRequest,
): Promise<readonly number[]> {
  return prefetchReaderSessionSpreads({
    sessionId: state.input.sessionId,
    isDisposed: () => state.disposed,
    revisions: state.revisions,
    document: state.input.document,
    frameSource: { ...state.input, manifestHrefs: state.manifestHrefs },
    buildFrame: state.buildFrame,
    ...(state.storeResourceTransfer !== undefined
      ? { storeResourceTransfer: state.storeResourceTransfer }
      : {}),
    ...(state.input.logger !== undefined ? { logger: state.input.logger } : {}),
    request,
  });
}

function disposeSession(state: ReaderSessionState): void {
  if (state.disposed) return;
  state.disposed = true;
  try {
    state.input.document.close();
  } finally {
    releaseResourceTransfers(state);
  }
}

function createSequentialRevisionId(): CreateReaderRevisionId {
  let next = 1;
  return () => `rev-${String(next++)}`;
}

function releaseResourceTransfers(state: ReaderSessionState, revisionId?: ReaderRevisionId): void {
  releaseSessionResourceTransfers({
    sessionId: state.input.sessionId,
    ...(state.releaseResourceTransfers !== undefined
      ? { releaseResourceTransfers: state.releaseResourceTransfers }
      : {}),
    ...(revisionId !== undefined ? { revisionId } : {}),
    ...(state.input.logger !== undefined ? { logger: state.input.logger } : {}),
  });
}
