import type { RitoCoreWasmSourcePoint, RitoCoreWasmSourceRange } from './interaction-source';

/** The one persisted annotation format, built and read only by the engine. */
export interface RitoCoreWasmAnnotationTarget {
  readonly version: 1;
  /** Canonical manifest href of the chapter. */
  readonly href: string;
  readonly sourceRange: RitoCoreWasmSourceRange;
  readonly quote: RitoCoreWasmAnnotationQuote;
  readonly position: RitoCoreWasmAnnotationPosition;
}

export interface RitoCoreWasmAnnotationQuote {
  readonly exact: string;
  readonly prefix: string;
  readonly suffix: string;
}

/** UTF-16 offsets into the chapter's canonical text, and its length at creation. */
export interface RitoCoreWasmAnnotationPosition {
  readonly start: number;
  readonly end: number;
  readonly chapterLength: number;
}

export interface RitoCoreWasmAnnotationTargetRequest {
  readonly href: string;
  readonly sourceRange: RitoCoreWasmSourceRange;
}

export type RitoCoreWasmAnnotationResolutionLevel = 'exact' | 'quote' | 'position' | 'progression';

export type RitoCoreWasmAnnotationTargetResolution =
  | {
      readonly level: RitoCoreWasmAnnotationResolutionLevel;
      /** The target re-anchored where it landed. */
      readonly target: RitoCoreWasmAnnotationTarget;
    }
  | { readonly level: 'orphaned'; readonly reason: 'hrefNotFound' | 'emptyChapter' };

/** A manifest href and a point in its source tree. */
export interface RitoCoreWasmSourcePosition {
  readonly href: string;
  readonly point: RitoCoreWasmSourcePoint;
}

/** A reading-position question the engine answers from the source alone. */
export type RitoCoreWasmPositionQuery =
  | {
      readonly kind: 'tocEntryAtPosition';
      readonly href: string;
      readonly point: RitoCoreWasmSourcePoint;
    }
  | {
      readonly kind: 'compare';
      readonly first: RitoCoreWasmSourcePosition;
      readonly second: RitoCoreWasmSourcePosition;
    };

export type RitoCoreWasmPositionAnswer =
  /** The TOC entry's preorder index, or null when none precedes. */
  | { readonly kind: 'tocEntry'; readonly tocIndex: number | null }
  /** -1, 0 or 1 as the first position reads before, at or after the second. */
  | { readonly kind: 'order'; readonly order: -1 | 0 | 1 };
