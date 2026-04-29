import type { ReaderRuntimeCommand, ReaderRuntimeResponse } from './protocol';
import type {
  FootnoteRequest,
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
  ResolveLocatorGeometryRequest,
  ResolveLocatorRequest,
  ResolvedLocator,
  ResolvedLocatorGeometry,
  ResourceRequest,
  SearchBatch,
  SearchRequest,
  SpreadFrameRequest,
} from './types';

export type DispatchReaderRuntimeCommand = (
  command: ReaderRuntimeCommand,
) => Promise<ReaderRuntimeResponse>;

export interface CreateReaderRuntimeClientInput {
  readonly dispatch: DispatchReaderRuntimeCommand;
  readonly createRequestId?: () => ReaderRuntimeRequestId;
}

export interface ReaderRuntimeClient {
  readonly sessionId: ReaderSessionId | undefined;
  readonly activeRevisionId: ReaderRevisionId | undefined;
  openSession(publicationRef: string): Promise<ReaderPublication>;
  createRevision(request: ReaderLayoutRequest): Promise<ReaderRevision>;
  cancelRevision(): Promise<void>;
  resolveLocator(request: ResolveLocatorRequest): Promise<ResolvedLocator>;
  resolveLocatorGeometry(request: ResolveLocatorGeometryRequest): Promise<ResolvedLocatorGeometry>;
  getSpreadFrame(request: SpreadFrameRequest): Promise<ReaderSpreadFrame>;
  getFootnote(request: FootnoteRequest): Promise<ReaderFootnotePayload>;
  getResource(request: ResourceRequest): Promise<ReaderResourcePayload>;
  prefetch(request: PrefetchRequest): Promise<readonly number[]>;
  search(request: SearchRequest): Promise<SearchBatch>;
  close(): Promise<void>;
}

export interface ReaderRuntimeClientState {
  readonly dispatch: DispatchReaderRuntimeCommand;
  readonly createRequestId: () => ReaderRuntimeRequestId;
  sessionId: ReaderSessionId | undefined;
  activeRevisionId: ReaderRevisionId | undefined;
  openingRequestId: ReaderRuntimeRequestId | undefined;
  latestCreateRevisionRequestId: ReaderRuntimeRequestId | undefined;
  closed: boolean;
}
