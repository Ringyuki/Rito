import type { RitoCoreWasmSourceRange } from './interaction-source';

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
