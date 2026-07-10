import type { RitoCoreWasmJsonObject } from './common';
import type { RitoCoreWasmSearchTextPosition } from './search';

export interface RitoCoreWasmPageTargets {
  readonly revisionId: string;
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly entryCount: number;
  readonly textHash: string;
  readonly entries: readonly RitoCoreWasmJsonObject[];
}

export interface RitoCoreWasmTextRunOffset {
  readonly start: number;
  readonly end: number;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
}

export interface RitoCoreWasmPageTextPositions {
  readonly revisionId: string;
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly text: string;
  readonly textLength: number;
  readonly textHash: string;
  readonly offsets: readonly RitoCoreWasmTextRunOffset[];
}

export interface RitoCoreWasmTextRangeGeometryRequest {
  readonly pageIndex: number;
  readonly start: RitoCoreWasmSearchTextPosition;
  readonly end: RitoCoreWasmSearchTextPosition;
}

export interface RitoCoreWasmTextRangeRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly startCharIndex: number;
  readonly endCharIndex: number;
}

export interface RitoCoreWasmTextRangeGeometry {
  readonly revisionId: string;
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly rectCount: number;
  readonly rects: readonly RitoCoreWasmTextRangeRect[];
}
