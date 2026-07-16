import type { RitoCoreWasmResourceKind } from './common';
import type { RitoCoreWasmFrameCommandBufferMetadata } from './frame';
import type {
  RitoCoreWasmChapterTextIndices,
  RitoCoreWasmExactSourceRangeRequest,
  RitoCoreWasmExactSourceRangeResponse,
  RitoCoreWasmFootnote,
  RitoCoreWasmFootnotes,
  RitoCoreWasmTextRangeRequest,
  RitoCoreWasmTextRangeResponse,
  RitoCoreWasmTextRangeFromPointsRequest,
  RitoCoreWasmTextRangeFromPointsResponse,
  RitoCoreWasmTextRangeToPointRequest,
  RitoCoreWasmTextRangeToPointResponse,
  RitoCoreWasmSourceLocator,
  RitoCoreWasmSourceLocatorResolution,
  RitoCoreWasmTextCaretResponse,
  RitoCoreWasmTextPointRequest,
} from './interaction';
import type { RitoCoreWasmLocatorRequest, RitoCoreWasmResolvedLocator } from './navigation';
import type { RitoCoreWasmPageReadingAnchor } from './reading-anchor';
import type {
  RitoCoreWasmPageSemantics,
  RitoCoreWasmPageTargets,
  RitoCoreWasmPageTextPositions,
  RitoCoreWasmTextRangeGeometry,
  RitoCoreWasmTextRangeGeometryRequest,
} from './page';
import type {
  RitoCoreWasmReaderFrameBuffer,
  RitoCoreWasmReaderFrameWindowWarmResult,
  RitoCoreWasmReaderResourceBytes,
} from './reader-worker';
import type { RitoCoreWasmPlannedFrameResourcePrefetchResponse } from './resource';
import type { RitoCoreWasmShapeProvenanceDiagnostic } from './shape-provenance';
import type { RitoCoreWasmResourcePayload } from './resource';
import type { RitoCoreWasmSearchRequest, RitoCoreWasmSearchResponse } from './search';
import type {
  RitoCoreWasmBoundedRevisionRequest,
  RitoCoreWasmCancelRevisionRequest,
  RitoCoreWasmContinueRevisionRequest,
  RitoCoreWasmRevisionAdvance,
  RitoCoreWasmRevisionBundle,
  RitoCoreWasmRevisionHandle,
  RitoCoreWasmRevisionNavigation,
  RitoCoreWasmRevisionPresentation,
  RitoCoreWasmRevisionRelease,
  RitoCoreWasmRevisionReleaseResult,
  RitoCoreWasmRevisionSummary,
  RitoCoreWasmRevisionTransferRelease,
  RitoCoreWasmRevisionWorkBudget,
  RitoCoreWasmVersioned,
} from './revision';

export interface RitoCoreWasmReaderVersionedClient {
  createBoundedRevision(
    request: RitoCoreWasmBoundedRevisionRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionAdvance>>;
  continueRevision(
    request: RitoCoreWasmContinueRevisionRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionAdvance>>;
  cancelRevision(
    request: RitoCoreWasmCancelRevisionRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionSummary>>;
  getRevisionSummaryAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionSummary>>;
  getRevisionBundleAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    includeTocTargets?: boolean,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionBundle>>;
  getRevisionPresentationAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionPresentation>>;
  getShapeProvenanceDiagnosticAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmShapeProvenanceDiagnostic>>;
  getRevisionNavigationAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionNavigation>>;
  readFrameBufferAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    spreadIndex: number,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmReaderFrameBuffer>>;
  warmFrameWindowAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    spreadIndex: number,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmReaderFrameWindowWarmResult>>;
  getPageTargetsAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    pageIndex: number,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmPageTargets>>;
  getPageSemanticsAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    pageIndex: number,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmPageSemantics>>;
  getPageReadingAnchorAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    pageIndex: number,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmPageReadingAnchor>>;
  getPageTextPositionsAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    pageIndex: number,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmPageTextPositions>>;
  getTextRangeGeometryAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextRangeGeometryRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmReaderTextRangeGeometryDiagnostic>>;
  resolveTextCaretAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextPointRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmTextCaretResponse>>;
  resolveTextRangeAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextRangeRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmTextRangeResponse>>;
  resolveTextRangeFromPointsAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextRangeFromPointsRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmTextRangeFromPointsResponse>>;
  resolveTextRangeToPointAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextRangeToPointRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmTextRangeToPointResponse>>;
  resolveExactSourceRangeAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmExactSourceRangeRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmExactSourceRangeResponse>>;
  getFootnoteAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    key: string,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmFootnote>>;
  getFootnotesAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmFootnotes>>;
  getChapterTextIndicesAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmChapterTextIndices>>;
  searchAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmSearchRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmSearchResponse>>;
  resolveLocatorAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    locator: RitoCoreWasmLocatorRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmResolvedLocator>>;
  readResourceAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    kind: RitoCoreWasmResourceKind,
    href: string,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmReaderResourceBytes>>;
  resolveSourceLocatorAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    locator: RitoCoreWasmSourceLocator,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmSourceLocatorResolution>>;
  releaseRevisionTransfersAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmRevisionTransferRelease>;
  releaseRevisionAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmRevisionRelease>;
}

export interface RitoCoreWasmReaderVersionedDocumentRuntime {
  createBoundedRevision(request: RitoCoreWasmBoundedRevisionRequest): RitoCoreWasmRevisionAdvance;
  continueRevision(request: RitoCoreWasmContinueRevisionRequest): RitoCoreWasmRevisionAdvance;
  cancelRevision(request: RitoCoreWasmCancelRevisionRequest): RitoCoreWasmRevisionSummary;
  getRevisionSummaryAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): RitoCoreWasmVersioned<RitoCoreWasmRevisionSummary>;
  getRevisionBundleAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    includeTocTargets?: boolean,
  ): RitoCoreWasmVersioned<RitoCoreWasmRevisionBundle>;
  getRevisionPresentationAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): RitoCoreWasmVersioned<RitoCoreWasmRevisionPresentation>;
  getShapeProvenanceDiagnosticAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): RitoCoreWasmVersioned<RitoCoreWasmShapeProvenanceDiagnostic>;
  getRevisionNavigationAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): RitoCoreWasmVersioned<RitoCoreWasmRevisionNavigation>;
  getFrameCommandBufferMetadataAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    spreadIndex: number,
  ): RitoCoreWasmVersioned<RitoCoreWasmFrameCommandBufferMetadata>;
  readFrameCommandBufferAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    spreadIndex: number,
  ): RitoCoreWasmVersioned<Uint8Array>;
  prefetchPlannedFrameResourcesAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    spreadIndex: number,
  ): RitoCoreWasmVersioned<RitoCoreWasmPlannedFrameResourcePrefetchResponse>;
  warmFrameWindowAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    spreadIndex: number,
  ): RitoCoreWasmVersioned<RitoCoreWasmReaderFrameWindowWarmResult>;
  getPageTargetsAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    pageIndex: number,
  ): RitoCoreWasmVersioned<RitoCoreWasmPageTargets>;
  getPageSemanticsAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    pageIndex: number,
  ): RitoCoreWasmVersioned<RitoCoreWasmPageSemantics>;
  getPageReadingAnchorAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    pageIndex: number,
  ): RitoCoreWasmVersioned<RitoCoreWasmPageReadingAnchor>;
  getPageTextPositionsAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    pageIndex: number,
  ): RitoCoreWasmVersioned<RitoCoreWasmPageTextPositions>;
  getTextRangeGeometryAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextRangeGeometryRequest,
  ): RitoCoreWasmVersioned<RitoCoreWasmTextRangeGeometry>;
  resolveTextCaretAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextPointRequest,
  ): RitoCoreWasmVersioned<RitoCoreWasmTextCaretResponse>;
  resolveTextRangeAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextRangeRequest,
  ): RitoCoreWasmVersioned<RitoCoreWasmTextRangeResponse>;
  resolveTextRangeFromPointsAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextRangeFromPointsRequest,
  ): RitoCoreWasmVersioned<RitoCoreWasmTextRangeFromPointsResponse>;
  resolveTextRangeToPointAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmTextRangeToPointRequest,
  ): RitoCoreWasmVersioned<RitoCoreWasmTextRangeToPointResponse>;
  resolveExactSourceRangeAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmExactSourceRangeRequest,
  ): RitoCoreWasmVersioned<RitoCoreWasmExactSourceRangeResponse>;
  getFootnoteAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    key: string,
  ): RitoCoreWasmVersioned<RitoCoreWasmFootnote>;
  getFootnotesAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): RitoCoreWasmVersioned<RitoCoreWasmFootnotes>;
  getChapterTextIndicesAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): RitoCoreWasmVersioned<RitoCoreWasmChapterTextIndices>;
  searchAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmSearchRequest,
  ): RitoCoreWasmVersioned<RitoCoreWasmSearchResponse>;
  resolveLocatorAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    locator: RitoCoreWasmLocatorRequest,
  ): RitoCoreWasmVersioned<RitoCoreWasmResolvedLocator>;
  getResourcePayloadAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    kind: RitoCoreWasmResourceKind,
    href: string,
  ): RitoCoreWasmVersioned<RitoCoreWasmResourcePayload>;
  resolveSourceLocatorAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    locator: RitoCoreWasmSourceLocator,
  ): RitoCoreWasmVersioned<RitoCoreWasmSourceLocatorResolution>;
  releaseRevisionTransfersAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): RitoCoreWasmRevisionTransferRelease;
  releaseRevisionAtRevision(revision: RitoCoreWasmRevisionHandle): RitoCoreWasmRevisionRelease;
  takeResourceTransfer(transferId: string): Uint8Array;
  releaseResourceTransfer(transferId: string): boolean;
}

/**
 * Private Worker transport for legacy, approximate range geometry.
 *
 * The normalized request echo binds a response to one exact diagnostic read.
 * It does not make the geometry suitable for selection: the legacy geometry
 * DTO has no shaped caret stops or per-run UTF-16 boundary table.
 */
export interface RitoCoreWasmReaderTextRangeGeometryDiagnostic {
  readonly request: RitoCoreWasmTextRangeGeometryRequest;
  readonly geometry: RitoCoreWasmTextRangeGeometry;
}

/** Private Worker echo binding a canonical source resolution to its exact request. */
export interface RitoCoreWasmReaderSourceLocatorTransport {
  readonly request: RitoCoreWasmSourceLocator;
  readonly resolution: RitoCoreWasmSourceLocatorResolution;
}

/** Private Worker echo that binds a caret response to one exact point request. */
export interface RitoCoreWasmReaderTextCaretTransport {
  readonly request: RitoCoreWasmTextPointRequest;
  readonly response: RitoCoreWasmTextCaretResponse;
}

/** Private Worker echo that binds a range response to its exact endpoint pair. */
export interface RitoCoreWasmReaderTextRangeTransport {
  readonly request: RitoCoreWasmTextRangeRequest;
  readonly response: RitoCoreWasmTextRangeResponse;
}

/** Private Worker echo binding a granular point-range response to both input points. */
export interface RitoCoreWasmReaderTextRangeFromPointsTransport {
  readonly request: RitoCoreWasmTextRangeFromPointsRequest;
  readonly response: RitoCoreWasmTextRangeFromPointsResponse;
}

/** Private Worker echo binding a stable-prefix anchor and live focus point. */
export interface RitoCoreWasmReaderTextRangeToPointTransport {
  readonly request: RitoCoreWasmTextRangeToPointRequest;
  readonly response: RitoCoreWasmTextRangeToPointResponse;
}

/** Private Worker echo binding exact source projection to its durable request. */
export interface RitoCoreWasmReaderExactSourceRangeTransport {
  readonly request: RitoCoreWasmExactSourceRangeRequest;
  readonly response: RitoCoreWasmExactSourceRangeResponse;
}

export interface RitoCoreWasmReaderVersionedErrorMetadata {
  readonly revision?: RitoCoreWasmRevisionSummary | undefined;
}

export interface RitoCoreWasmReaderVersionedWorkerHandlerDeps {
  readonly normalizeRitoCoreWasmError: (
    error: unknown,
    operation?: string,
  ) => Error & {
    readonly code?: string | undefined;
    readonly revision?: RitoCoreWasmRevisionSummary | undefined;
  };
}

type VersionedWorkerRequestId = { readonly id: number };
type RevisionRequest<K extends string> = VersionedWorkerRequestId & {
  readonly kind: K;
  readonly revision: RitoCoreWasmRevisionHandle;
};

export type RitoCoreWasmReaderWorkerCreateBoundedRevisionRequest = VersionedWorkerRequestId & {
  readonly kind: 'createBoundedRevision';
  readonly request: RitoCoreWasmBoundedRevisionRequest;
};

export type RitoCoreWasmReaderWorkerContinueRevisionRequest =
  RevisionRequest<'continueRevision'> & {
    readonly cursor: string;
    readonly budget: RitoCoreWasmRevisionWorkBudget;
  };

export type RitoCoreWasmReaderWorkerCancelRevisionRequest = RevisionRequest<'cancelRevision'>;
export type RitoCoreWasmReaderWorkerGetRevisionSummaryRequest =
  RevisionRequest<'getRevisionSummaryAtRevision'>;
export type RitoCoreWasmReaderWorkerGetRevisionBundleRequest =
  RevisionRequest<'getRevisionBundleAtRevision'> & {
    readonly includeTocTargets?: boolean | undefined;
  };
export type RitoCoreWasmReaderWorkerGetRevisionPresentationRequest =
  RevisionRequest<'getRevisionPresentationAtRevision'>;
export type RitoCoreWasmReaderWorkerGetShapeProvenanceDiagnosticRequest =
  RevisionRequest<'getShapeProvenanceDiagnosticAtRevision'>;
export type RitoCoreWasmReaderWorkerGetRevisionNavigationRequest =
  RevisionRequest<'getRevisionNavigationAtRevision'>;
export type RitoCoreWasmReaderWorkerReadFrameBufferRequest =
  RevisionRequest<'readFrameBufferAtRevision'> & { readonly spreadIndex: number };
export type RitoCoreWasmReaderWorkerWarmFrameWindowAtRevisionRequest =
  RevisionRequest<'warmFrameWindowAtRevision'> & { readonly spreadIndex: number };
export type RitoCoreWasmReaderWorkerGetPageTargetsAtRevisionRequest =
  RevisionRequest<'getPageTargetsAtRevision'> & { readonly pageIndex: number };
export type RitoCoreWasmReaderWorkerGetPageSemanticsAtRevisionRequest =
  RevisionRequest<'getPageSemanticsAtRevision'> & { readonly pageIndex: number };
export type RitoCoreWasmReaderWorkerGetPageReadingAnchorAtRevisionRequest =
  RevisionRequest<'getPageReadingAnchorAtRevision'> & { readonly pageIndex: number };
export type RitoCoreWasmReaderWorkerGetPageTextPositionsAtRevisionRequest =
  RevisionRequest<'getPageTextPositionsAtRevision'> & { readonly pageIndex: number };
export type RitoCoreWasmReaderWorkerGetTextRangeGeometryAtRevisionRequest =
  RevisionRequest<'getTextRangeGeometryAtRevision'> & {
    readonly request: RitoCoreWasmTextRangeGeometryRequest;
  };
export type RitoCoreWasmReaderWorkerResolveTextCaretAtRevisionRequest =
  RevisionRequest<'resolveTextCaretAtRevision'> & {
    readonly request: RitoCoreWasmTextPointRequest;
  };
export type RitoCoreWasmReaderWorkerResolveTextRangeAtRevisionRequest =
  RevisionRequest<'resolveTextRangeAtRevision'> & {
    readonly request: RitoCoreWasmTextRangeRequest;
  };
export type RitoCoreWasmReaderWorkerResolveTextRangeFromPointsAtRevisionRequest =
  RevisionRequest<'resolveTextRangeFromPointsAtRevision'> & {
    readonly request: RitoCoreWasmTextRangeFromPointsRequest;
  };
export type RitoCoreWasmReaderWorkerResolveTextRangeToPointAtRevisionRequest =
  RevisionRequest<'resolveTextRangeToPointAtRevision'> & {
    readonly request: RitoCoreWasmTextRangeToPointRequest;
  };
export type RitoCoreWasmReaderWorkerResolveExactSourceRangeAtRevisionRequest =
  RevisionRequest<'resolveExactSourceRangeAtRevision'> & {
    readonly request: RitoCoreWasmExactSourceRangeRequest;
  };
export type RitoCoreWasmReaderWorkerGetFootnoteAtRevisionRequest =
  RevisionRequest<'getFootnoteAtRevision'> & { readonly key: string };
export type RitoCoreWasmReaderWorkerGetFootnotesAtRevisionRequest =
  RevisionRequest<'getFootnotesAtRevision'>;
export type RitoCoreWasmReaderWorkerGetChapterTextIndicesAtRevisionRequest =
  RevisionRequest<'getChapterTextIndicesAtRevision'>;
export type RitoCoreWasmReaderWorkerSearchAtRevisionRequest =
  RevisionRequest<'searchAtRevision'> & {
    readonly request: RitoCoreWasmSearchRequest;
  };
export type RitoCoreWasmReaderWorkerResolveLocatorAtRevisionRequest =
  RevisionRequest<'resolveLocatorAtRevision'> & {
    readonly locator: RitoCoreWasmLocatorRequest;
  };
export type RitoCoreWasmReaderWorkerReadResourceAtRevisionRequest =
  RevisionRequest<'readResourceAtRevision'> & {
    readonly resourceKind: RitoCoreWasmResourceKind;
    readonly href: string;
  };
export type RitoCoreWasmReaderWorkerResolveSourceLocatorRequest =
  RevisionRequest<'resolveSourceLocatorAtRevision'> & {
    readonly locator: RitoCoreWasmSourceLocator;
  };
export type RitoCoreWasmReaderWorkerReleaseRevisionTransfersAtRevisionRequest =
  RevisionRequest<'releaseRevisionTransfersAtRevision'>;
export type RitoCoreWasmReaderWorkerReleaseRevisionAtRevisionRequest =
  RevisionRequest<'releaseRevisionAtRevision'>;

export type RitoCoreWasmReaderVersionedWorkerRequest =
  | RitoCoreWasmReaderWorkerCreateBoundedRevisionRequest
  | RitoCoreWasmReaderWorkerContinueRevisionRequest
  | RitoCoreWasmReaderWorkerCancelRevisionRequest
  | RitoCoreWasmReaderWorkerGetRevisionSummaryRequest
  | RitoCoreWasmReaderWorkerGetRevisionBundleRequest
  | RitoCoreWasmReaderWorkerGetRevisionPresentationRequest
  | RitoCoreWasmReaderWorkerGetShapeProvenanceDiagnosticRequest
  | RitoCoreWasmReaderWorkerGetRevisionNavigationRequest
  | RitoCoreWasmReaderWorkerReadFrameBufferRequest
  | RitoCoreWasmReaderWorkerWarmFrameWindowAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetPageTargetsAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetPageSemanticsAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetPageReadingAnchorAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetPageTextPositionsAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetTextRangeGeometryAtRevisionRequest
  | RitoCoreWasmReaderWorkerResolveTextCaretAtRevisionRequest
  | RitoCoreWasmReaderWorkerResolveTextRangeAtRevisionRequest
  | RitoCoreWasmReaderWorkerResolveTextRangeFromPointsAtRevisionRequest
  | RitoCoreWasmReaderWorkerResolveTextRangeToPointAtRevisionRequest
  | RitoCoreWasmReaderWorkerResolveExactSourceRangeAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetFootnoteAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetFootnotesAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetChapterTextIndicesAtRevisionRequest
  | RitoCoreWasmReaderWorkerSearchAtRevisionRequest
  | RitoCoreWasmReaderWorkerResolveLocatorAtRevisionRequest
  | RitoCoreWasmReaderWorkerReadResourceAtRevisionRequest
  | RitoCoreWasmReaderWorkerResolveSourceLocatorRequest
  | RitoCoreWasmReaderWorkerReleaseRevisionTransfersAtRevisionRequest
  | RitoCoreWasmReaderWorkerReleaseRevisionAtRevisionRequest;

type OmitRequestId<Request> = Request extends unknown ? Omit<Request, 'id'> : never;

export type RitoCoreWasmReaderVersionedWorkerRequestPayload =
  OmitRequestId<RitoCoreWasmReaderVersionedWorkerRequest>;

export interface RitoCoreWasmReaderWorkerVersionedResponse<Kind extends string, Result> {
  readonly kind: Kind;
  readonly revision: RitoCoreWasmRevisionHandle;
  readonly result: Result;
}

export type RitoCoreWasmReaderVersionedWorkerResponse =
  | RitoCoreWasmReaderWorkerVersionedResponse<'createBoundedRevision', RitoCoreWasmRevisionAdvance>
  | RitoCoreWasmReaderWorkerVersionedResponse<'continueRevision', RitoCoreWasmRevisionAdvance>
  | RitoCoreWasmReaderWorkerVersionedResponse<'cancelRevision', RitoCoreWasmRevisionSummary>
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getRevisionSummaryAtRevision',
      RitoCoreWasmRevisionSummary
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getRevisionBundleAtRevision',
      RitoCoreWasmRevisionBundle
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getRevisionPresentationAtRevision',
      RitoCoreWasmRevisionPresentation
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getShapeProvenanceDiagnosticAtRevision',
      RitoCoreWasmShapeProvenanceDiagnostic
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getRevisionNavigationAtRevision',
      RitoCoreWasmRevisionNavigation
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'readFrameBufferAtRevision',
      RitoCoreWasmReaderFrameBuffer
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'warmFrameWindowAtRevision',
      RitoCoreWasmReaderFrameWindowWarmResult
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<'getPageTargetsAtRevision', RitoCoreWasmPageTargets>
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getPageSemanticsAtRevision',
      RitoCoreWasmPageSemantics
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getPageReadingAnchorAtRevision',
      RitoCoreWasmPageReadingAnchor
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getPageTextPositionsAtRevision',
      RitoCoreWasmPageTextPositions
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getTextRangeGeometryAtRevision',
      RitoCoreWasmReaderTextRangeGeometryDiagnostic
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'resolveTextCaretAtRevision',
      RitoCoreWasmReaderTextCaretTransport
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'resolveTextRangeAtRevision',
      RitoCoreWasmReaderTextRangeTransport
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'resolveTextRangeFromPointsAtRevision',
      RitoCoreWasmReaderTextRangeFromPointsTransport
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'resolveTextRangeToPointAtRevision',
      RitoCoreWasmReaderTextRangeToPointTransport
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'resolveExactSourceRangeAtRevision',
      RitoCoreWasmReaderExactSourceRangeTransport
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<'getFootnoteAtRevision', RitoCoreWasmFootnote>
  | RitoCoreWasmReaderWorkerVersionedResponse<'getFootnotesAtRevision', RitoCoreWasmFootnotes>
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'getChapterTextIndicesAtRevision',
      RitoCoreWasmChapterTextIndices
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<'searchAtRevision', RitoCoreWasmSearchResponse>
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'resolveLocatorAtRevision',
      RitoCoreWasmResolvedLocator
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'readResourceAtRevision',
      RitoCoreWasmReaderResourceBytes
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'resolveSourceLocatorAtRevision',
      RitoCoreWasmReaderSourceLocatorTransport
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<'releaseRevisionTransfersAtRevision', number>
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'releaseRevisionAtRevision',
      RitoCoreWasmRevisionReleaseResult
    >;
