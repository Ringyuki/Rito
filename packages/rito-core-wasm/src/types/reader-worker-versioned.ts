import type { RitoCoreWasmResourceKind } from './common';
import type { RitoCoreWasmFrameCommandBufferMetadata } from './frame';
import type {
  RitoCoreWasmFootnote,
  RitoCoreWasmSameFlowTextRangeRequest,
  RitoCoreWasmSameFlowTextRangeResponse,
  RitoCoreWasmSourceLocator,
  RitoCoreWasmSourceLocatorResolution,
  RitoCoreWasmTextCaretResponse,
  RitoCoreWasmTextPointRequest,
} from './interaction';
import type { RitoCoreWasmLocatorRequest, RitoCoreWasmResolvedLocator } from './navigation';
import type {
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
import type {
  RitoCoreWasmBoundedRevisionRequest,
  RitoCoreWasmCancelRevisionRequest,
  RitoCoreWasmContinueRevisionRequest,
  RitoCoreWasmRevisionAdvance,
  RitoCoreWasmRevisionHandle,
  RitoCoreWasmRevisionNavigation,
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
  resolveSameFlowTextRangeAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmSameFlowTextRangeRequest,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmSameFlowTextRangeResponse>>;
  getFootnoteAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    key: string,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmFootnote>>;
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
  resolveSameFlowTextRangeAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    request: RitoCoreWasmSameFlowTextRangeRequest,
  ): RitoCoreWasmVersioned<RitoCoreWasmSameFlowTextRangeResponse>;
  getFootnoteAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    key: string,
  ): RitoCoreWasmVersioned<RitoCoreWasmFootnote>;
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

/** Private Worker echo that binds a caret response to one exact point request. */
export interface RitoCoreWasmReaderTextCaretTransport {
  readonly request: RitoCoreWasmTextPointRequest;
  readonly response: RitoCoreWasmTextCaretResponse;
}

/** Private Worker echo that binds a range response to its exact endpoint pair. */
export interface RitoCoreWasmReaderSameFlowTextRangeTransport {
  readonly request: RitoCoreWasmSameFlowTextRangeRequest;
  readonly response: RitoCoreWasmSameFlowTextRangeResponse;
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
export type RitoCoreWasmReaderWorkerResolveSameFlowTextRangeAtRevisionRequest =
  RevisionRequest<'resolveSameFlowTextRangeAtRevision'> & {
    readonly request: RitoCoreWasmSameFlowTextRangeRequest;
  };
export type RitoCoreWasmReaderWorkerGetFootnoteAtRevisionRequest =
  RevisionRequest<'getFootnoteAtRevision'> & { readonly key: string };
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
  | RitoCoreWasmReaderWorkerGetShapeProvenanceDiagnosticRequest
  | RitoCoreWasmReaderWorkerGetRevisionNavigationRequest
  | RitoCoreWasmReaderWorkerReadFrameBufferRequest
  | RitoCoreWasmReaderWorkerWarmFrameWindowAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetPageTargetsAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetPageTextPositionsAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetTextRangeGeometryAtRevisionRequest
  | RitoCoreWasmReaderWorkerResolveTextCaretAtRevisionRequest
  | RitoCoreWasmReaderWorkerResolveSameFlowTextRangeAtRevisionRequest
  | RitoCoreWasmReaderWorkerGetFootnoteAtRevisionRequest
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
      'resolveSameFlowTextRangeAtRevision',
      RitoCoreWasmReaderSameFlowTextRangeTransport
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<'getFootnoteAtRevision', RitoCoreWasmFootnote>
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
      RitoCoreWasmSourceLocatorResolution
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<'releaseRevisionTransfersAtRevision', number>
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'releaseRevisionAtRevision',
      RitoCoreWasmRevisionReleaseResult
    >;
