import type { RitoCoreWasmJsonValue } from './common';
import type { RitoCoreWasmFrameCommand } from './frame-command';
import type { RitoReaderPrimitiveV1 } from './reader-v1-primitive';

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

/**
 * Describes a cached frame's bytes: the `RITODL1` format-2 primitive list
 * its display commands lower to at `ratio` device pixels per CSS pixel.
 * The command count, kind counts and hash describe the semantic frame the
 * bytes were lowered from; `primitiveCount` and `byteLength` describe the
 * bytes.
 */
export interface RitoFrameCommandBufferMetadata {
  readonly protocolVersion: number;
  readonly ratio: number;
  readonly commandCount: number;
  readonly commandCounts: Readonly<Record<string, number>>;
  readonly primitiveCount: number;
  readonly byteLength: number;
  readonly commandHash: string;
  readonly resourceRefCount: number;
  readonly resourceTable: readonly string[];
  readonly fontFamilies: readonly string[];
  readonly imageDominated: boolean;
}

export interface DecodedRitoFrameCommandBuffer {
  readonly protocolVersion: number;
  readonly ratio: number;
  readonly commandCount: number;
  readonly commandCounts: Readonly<Record<string, number>>;
  readonly primitiveCount: number;
  readonly commandHash: string;
  readonly resourceRefCount: number;
  readonly resourceTable: readonly string[];
  readonly commands: readonly RitoReaderPrimitiveV1[];
}
