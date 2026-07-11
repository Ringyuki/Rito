import type { RitoCoreWasmResourceKind } from './common';
import type { RitoCoreWasmFrameCommandBufferMetadata } from './frame';
import type { RitoCoreWasmSourceLocator, RitoCoreWasmSourceLocatorResolution } from './interaction';
import type {
  RitoCoreWasmReaderFrameBuffer,
  RitoCoreWasmReaderResourceBytes,
} from './reader-worker';
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
  getRevisionNavigationAtRevision(
    revision: RitoCoreWasmRevisionHandle,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmRevisionNavigation>>;
  readFrameBufferAtRevision(
    revision: RitoCoreWasmRevisionHandle,
    spreadIndex: number,
  ): Promise<RitoCoreWasmVersioned<RitoCoreWasmReaderFrameBuffer>>;
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
export type RitoCoreWasmReaderWorkerGetRevisionNavigationRequest =
  RevisionRequest<'getRevisionNavigationAtRevision'>;
export type RitoCoreWasmReaderWorkerReadFrameBufferRequest =
  RevisionRequest<'readFrameBufferAtRevision'> & { readonly spreadIndex: number };
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
  | RitoCoreWasmReaderWorkerGetRevisionNavigationRequest
  | RitoCoreWasmReaderWorkerReadFrameBufferRequest
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
      'getRevisionNavigationAtRevision',
      RitoCoreWasmRevisionNavigation
    >
  | RitoCoreWasmReaderWorkerVersionedResponse<
      'readFrameBufferAtRevision',
      RitoCoreWasmReaderFrameBuffer
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
