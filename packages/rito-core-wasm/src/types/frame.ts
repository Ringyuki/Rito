import type { RitoCoreWasmJsonValue } from './common';
import type { RitoCoreWasmFrameCommand } from './frame-command';

export interface RitoCoreWasmDisplayListResourceRefs {
  readonly imageRefs: number;
  readonly uniqueImages: number;
  readonly imageHash: string;
  readonly images: readonly string[];
}

export interface RitoCoreWasmFrame {
  readonly revisionId: string;
  readonly spreadIndex: number;
  readonly pageIndexes: readonly number[];
  readonly width: RitoCoreWasmJsonValue;
  readonly height: RitoCoreWasmJsonValue;
  readonly commands: readonly RitoCoreWasmFrameCommand[];
  readonly commandCount: number;
  readonly commandCounts: Readonly<Record<string, number>>;
  readonly commandHash: string;
  readonly resourceRefs: RitoCoreWasmDisplayListResourceRefs;
  readonly fontFamilies: readonly string[];
  readonly imageDominated: boolean;
}

export interface RitoCoreWasmFrameCommandBufferMetadata extends RitoFrameCommandBufferMetadata {
  readonly revisionId: string;
  readonly spreadIndex: number;
  readonly width: number;
  readonly height: number;
}

export interface RitoFrameCommandBufferMetadata {
  readonly protocolVersion: number;
  readonly commandCount: number;
  readonly commandCounts: Readonly<Record<string, number>>;
  readonly recordStats: RitoFrameCommandBufferRecordStats;
  readonly byteLength: number;
  readonly commandHash: string;
  readonly resourceRefCount: number;
  readonly resourceTable: readonly string[];
  readonly fontFamilies: readonly string[];
  readonly imageDominated: boolean;
  readonly stringTable: readonly string[];
  readonly payloadTable: readonly string[];
}

export interface RitoFrameCommandBufferRecordStats {
  readonly geometryRecords: number;
  readonly paintRecords: number;
  readonly payloadRecords: number;
  readonly primaryStringRecords: number;
  readonly secondaryStringRecords: number;
}

export interface DecodedRitoFrameCommandBuffer {
  readonly protocolVersion: number;
  readonly commandCount: number;
  readonly commandCounts: Readonly<Record<string, number>>;
  readonly recordStats: RitoFrameCommandBufferRecordStats;
  readonly commandHash: string;
  readonly resourceRefCount: number;
  readonly resourceTable: readonly string[];
  readonly records: readonly DecodedRitoFrameCommandRecord[];
  readonly commands: readonly RitoCoreWasmFrameCommand[];
}

export interface DecodedRitoFrameCommandRecord {
  readonly opcode: number;
  readonly kind: RitoPackedFrameCommandKind;
  readonly flags: number;
  readonly hasGeometry: boolean;
  readonly hasPrimaryString: boolean;
  readonly hasSecondaryString: boolean;
  readonly hasPaint: boolean;
  readonly hasPayload: boolean;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly primaryString?: string | undefined;
  readonly secondaryString?: string | undefined;
  readonly payload?: string | undefined;
}

export type RitoPackedFrameCommandKind =
  | 'pushState'
  | 'popState'
  | 'translate'
  | 'opacity'
  | 'transform'
  | 'clipRect'
  | 'paintPage'
  | 'paintBlock'
  | 'paintText'
  | 'paintRuby'
  | 'paintImage'
  | 'paintHorizontalRule'
  | 'unknown';
