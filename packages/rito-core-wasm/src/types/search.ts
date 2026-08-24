import type { RitoCoreWasmSourceRange } from './interaction';

export interface RitoCoreWasmSearchTextPosition {
  readonly blockIndex: number;
  readonly lineIndex: number;
  readonly runIndex: number;
  readonly charIndex: number;
}

export interface RitoCoreWasmSearchMatchRange {
  readonly pageIndex: number;
  readonly start: RitoCoreWasmSearchTextPosition;
  readonly end: RitoCoreWasmSearchTextPosition;
  readonly context: string;
}

export interface RitoCoreWasmSearchResult {
  readonly pageIndex: number;
  readonly spreadIndex: number;
  readonly matchRange: RitoCoreWasmSearchMatchRange;
  /** Authoritative parsed-source ownership; geometry is resolved lazily. */
  readonly source: RitoCoreWasmSearchSource;
}

export type RitoCoreWasmSearchSource =
  | {
      readonly status: 'resolved';
      readonly href: string;
      readonly sourceRange: RitoCoreWasmSourceRange;
    }
  | {
      readonly status: 'unavailable';
      readonly reason: 'sourceUnavailable';
    };

export interface RitoCoreWasmSearchRequest {
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly limit?: number | undefined;
}

export interface RitoCoreWasmSearchResponse {
  readonly revisionId: string;
  readonly query: string;
  readonly caseSensitive: boolean;
  readonly wholeWord: boolean;
  readonly resultCount: number;
  readonly results: readonly RitoCoreWasmSearchResult[];
}
