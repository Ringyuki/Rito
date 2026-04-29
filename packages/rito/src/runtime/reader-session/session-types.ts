import type { ImageDimensions } from '../../layout/core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { Logger } from '../../utils/logger';
import type { EpubDocument } from '../types';
import type { BuildReaderSpreadFrameInput } from './frame';
import type { PaginateReaderRevision } from './revision';
import type { ReleaseReaderResourceTransfers, StoreReaderResourceTransfer } from './resource';
import type { ReaderSessionSearchRequest } from './session-search';
import type {
  PrefetchRequest,
  ReaderFootnotePayload,
  ReaderFootnoteRef,
  ReaderLayoutRequest,
  ReaderLocator,
  ReaderResourcePayload,
  ReaderResourceRef,
  ReaderRevision,
  ReaderRevisionId,
  ReaderSessionId,
  ReaderSpreadFrame,
  ResolveLocatorGeometryRequest,
  ResolvedLocator,
  ResolvedLocatorGeometry,
  SearchBatch,
} from './types';

export interface ReaderSessionResolveLocatorRequest {
  readonly revisionId: ReaderRevisionId;
  readonly locator: ReaderLocator;
}

export interface ReaderSessionResolveLocatorGeometryRequest extends ResolveLocatorGeometryRequest {
  readonly revisionId: ReaderRevisionId;
}

export interface ReaderSessionResourceRequest {
  readonly revisionId: ReaderRevisionId;
  readonly resource: ReaderResourceRef;
}

export interface ReaderSessionFootnoteRequest {
  readonly revisionId: ReaderRevisionId;
  readonly ref: ReaderFootnoteRef;
}

export interface ReaderSessionSpreadFrameRequest {
  readonly revisionId: ReaderRevisionId;
  readonly spreadIndex: number;
  readonly displayListOptions?: BuildReaderSpreadFrameInput['displayListOptions'];
}

export interface ReaderSessionPrefetchRequest {
  readonly revisionId: ReaderRevisionId;
  readonly spreadIndexes: PrefetchRequest['spreadIndexes'];
  readonly displayListOptions?: BuildReaderSpreadFrameInput['displayListOptions'];
}

export type BuildReaderSessionFrame = (input: BuildReaderSpreadFrameInput) => ReaderSpreadFrame;

export type CreateReaderRevisionId = () => ReaderRevisionId;

export type RegisterReaderSessionFonts = (input: {
  readonly sessionId: ReaderSessionId;
  readonly document: EpubDocument;
}) => void | Promise<void>;

export interface CreateReaderSessionInput {
  readonly sessionId: ReaderSessionId;
  readonly document: EpubDocument;
  readonly measurer: TextMeasurer;
  readonly images?: ReadonlyMap<string, ImageDimensions>;
  readonly logger?: Logger;
  readonly createRevisionId?: CreateReaderRevisionId;
  readonly now?: () => number;
  readonly paginateRevision?: PaginateReaderRevision;
  readonly buildFrame?: BuildReaderSessionFrame;
  readonly registerFonts?: RegisterReaderSessionFonts;
  readonly createResourceRef?: (href: string) => ReaderResourceRef;
  readonly createLocator?: BuildReaderSpreadFrameInput['createLocator'];
  readonly storeResourceTransfer?: StoreReaderResourceTransfer;
  readonly releaseResourceTransfers?: ReleaseReaderResourceTransfers;
}

export interface ReaderSession {
  readonly id: ReaderSessionId;
  createRevision(request: ReaderLayoutRequest): Promise<ReaderRevision>;
  getRevision(revisionId: ReaderRevisionId): ReaderRevision | undefined;
  cancelRevision(revisionId: ReaderRevisionId): void;
  resolveLocator(request: ReaderSessionResolveLocatorRequest): Promise<ResolvedLocator>;
  resolveLocatorGeometry(
    request: ReaderSessionResolveLocatorGeometryRequest,
  ): Promise<ResolvedLocatorGeometry>;
  getResource(request: ReaderSessionResourceRequest): Promise<ReaderResourcePayload>;
  getFootnote(request: ReaderSessionFootnoteRequest): Promise<ReaderFootnotePayload>;
  getSpreadFrame(request: ReaderSessionSpreadFrameRequest): Promise<ReaderSpreadFrame>;
  prefetch(request: ReaderSessionPrefetchRequest): Promise<readonly number[]>;
  search(request: ReaderSessionSearchRequest): Promise<SearchBatch>;
  dispose(): void;
}
