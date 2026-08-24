import type { RitoCoreWasmResourceKind } from './common';

export interface RitoCoreWasmResourcePayload {
  readonly revisionId: string;
  readonly transferId: string;
  readonly kind: RitoCoreWasmResourceKind;
  readonly href: string;
  readonly mediaType: string;
  readonly byteLength: number;
  readonly width?: number | undefined;
  readonly height?: number | undefined;
}

export interface RitoCoreWasmResourceRequest {
  readonly kind: RitoCoreWasmResourceKind;
  readonly href: string;
}

export interface RitoCoreWasmResourcePrefetchRequest {
  readonly resources: readonly RitoCoreWasmResourceRequest[];
}

export interface RitoCoreWasmMissingResource {
  readonly kind: RitoCoreWasmResourceKind;
  readonly href: string;
  readonly message: string;
}

export interface RitoCoreWasmResourcePrefetchResponse {
  readonly revisionId: string;
  readonly payloads: readonly RitoCoreWasmResourcePayload[];
  readonly missingResources: readonly RitoCoreWasmMissingResource[];
  readonly pendingTransferCount: number;
}

export interface RitoCoreWasmFrameResourcePrefetchResponse extends RitoCoreWasmResourcePrefetchResponse {
  readonly spreadIndex: number;
}

export interface RitoCoreWasmFrameResourceWarmPlan {
  readonly revisionId: string;
  readonly centerSpreadIndex: number;
  readonly displaySpreadIndex: number;
  readonly spreadIndexes: readonly number[];
}

export interface RitoCoreWasmPlannedFrameResourcePrefetchResponse {
  readonly plan: RitoCoreWasmFrameResourceWarmPlan;
  readonly spreads: readonly RitoCoreWasmFrameResourcePrefetchResponse[];
  readonly pendingTransferCount: number;
}
