import type {
  PrefetchRequest,
  ReaderFootnotePayload,
  ReaderLayoutRequest,
  ReaderPublication,
  ReaderResourcePayload,
  ReaderRevision,
  ReaderRevisionId,
  ReaderRuntimeRequestId,
  ReaderSessionId,
  ReaderSpreadFrame,
  ResolvedLocator,
  ResolvedLocatorGeometry,
  ResolveLocatorRequest,
  ResolveLocatorGeometryRequest,
  FootnoteRequest,
  ResourceRequest,
  SearchBatch,
  SearchRequest,
  SpreadFrameRequest,
} from './types';

export const READER_RUNTIME_PROTOCOL_VERSION = 1;

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

export type JsonObject = { readonly [key: string]: JsonValue };

export type ReaderProtocolErrorCode =
  | 'bad-request'
  | 'not-found'
  | 'cancelled'
  | 'stale-revision'
  | 'resource-unavailable'
  | 'not-supported'
  | 'internal-error';

export interface ReaderProtocolError {
  readonly code: ReaderProtocolErrorCode;
  readonly message: string;
  readonly retryable?: boolean;
  readonly details?: JsonObject;
}

export interface ReaderRuntimeCommandBase {
  readonly protocolVersion: typeof READER_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: ReaderRuntimeRequestId;
  readonly sessionId?: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
}

export interface OpenSessionCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'openSession';
  readonly payload: {
    readonly publicationRef: string;
  };
}

export interface CreateRevisionCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'createRevision';
  readonly sessionId: ReaderSessionId;
  readonly payload: ReaderLayoutRequest;
}

export interface CancelRevisionCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'cancelRevision';
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
}

export interface ResolveLocatorCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'resolveLocator';
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: ResolveLocatorRequest;
}

export interface ResolveLocatorGeometryCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'resolveLocatorGeometry';
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: ResolveLocatorGeometryRequest;
}

export interface GetSpreadFrameCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'getSpreadFrame';
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: SpreadFrameRequest;
}

export interface PrefetchCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'prefetch';
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: PrefetchRequest;
}

export interface SearchCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'search';
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: SearchRequest;
}

export interface GetFootnoteCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'getFootnote';
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: FootnoteRequest;
}

export interface GetResourceCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'getResource';
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: ResourceRequest;
}

export interface CloseSessionCommand extends ReaderRuntimeCommandBase {
  readonly kind: 'closeSession';
  readonly sessionId: ReaderSessionId;
}

export type ReaderRuntimeCommand =
  | OpenSessionCommand
  | CreateRevisionCommand
  | CancelRevisionCommand
  | ResolveLocatorCommand
  | ResolveLocatorGeometryCommand
  | GetSpreadFrameCommand
  | PrefetchCommand
  | SearchCommand
  | GetFootnoteCommand
  | GetResourceCommand
  | CloseSessionCommand;

export interface ReaderRuntimeResponseBase {
  readonly protocolVersion: typeof READER_RUNTIME_PROTOCOL_VERSION;
  readonly requestId: ReaderRuntimeRequestId;
  readonly sessionId?: ReaderSessionId;
  readonly revisionId?: ReaderRevisionId;
  readonly ok: boolean;
}

export interface OpenSessionResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'openSession';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly payload: {
    readonly publication: ReaderPublication;
  };
}

export interface CreateRevisionResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'createRevision';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: {
    readonly revision: ReaderRevision;
  };
}

export interface CancelRevisionResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'cancelRevision';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: {
    readonly cancelled: true;
  };
}

export interface ResolveLocatorResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'resolveLocator';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: ResolvedLocator;
}

export interface ResolveLocatorGeometryResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'resolveLocatorGeometry';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: ResolvedLocatorGeometry;
}

export interface GetSpreadFrameResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'getSpreadFrame';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: {
    readonly frame: ReaderSpreadFrame;
  };
}

export interface PrefetchResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'prefetch';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: {
    readonly spreadIndexes: readonly number[];
  };
}

export interface SearchResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'search';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: SearchBatch;
}

export interface GetFootnoteResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'getFootnote';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: ReaderFootnotePayload;
}

export interface GetResourceResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'getResource';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly revisionId: ReaderRevisionId;
  readonly payload: ReaderResourcePayload;
}

export interface CloseSessionResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'closeSession';
  readonly ok: true;
  readonly sessionId: ReaderSessionId;
  readonly payload: {
    readonly closed: true;
  };
}

export interface ReaderRuntimeErrorResponse extends ReaderRuntimeResponseBase {
  readonly kind: 'error';
  readonly ok: false;
  readonly error: ReaderProtocolError;
}

export type ReaderRuntimeSuccessResponse =
  | OpenSessionResponse
  | CreateRevisionResponse
  | CancelRevisionResponse
  | ResolveLocatorResponse
  | ResolveLocatorGeometryResponse
  | GetSpreadFrameResponse
  | PrefetchResponse
  | SearchResponse
  | GetFootnoteResponse
  | GetResourceResponse
  | CloseSessionResponse;

export type ReaderRuntimeResponse = ReaderRuntimeSuccessResponse | ReaderRuntimeErrorResponse;

export type ReaderRuntimeRevisionScopedResponse =
  | Extract<ReaderRuntimeSuccessResponse, { readonly revisionId: ReaderRevisionId }>
  | (ReaderRuntimeErrorResponse & { readonly revisionId: ReaderRevisionId });
