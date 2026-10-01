import type { RitoCoreWasmFootnotes } from './interaction';
import type { RitoCoreWasmTocEntry } from './publication';

/**
 * A published whole-book revision: its identity, the layout it was
 * paginated under and the size of its page table.
 */
export interface RitoCoreWasmRevisionSummary {
  readonly revisionId: string;
  readonly revisionVersion: number;
  readonly layoutKey: string;
  readonly pageCount: number;
  readonly spreadCount: number;
}

/** Stable identity for one published revision version. */
export interface RitoCoreWasmRevisionHandle {
  readonly revisionId: string;
  readonly revisionVersion: number;
}

/** A response value bound to the exact revision version that produced it. */
export interface RitoCoreWasmVersioned<T> {
  readonly revision: RitoCoreWasmRevisionHandle;
  readonly value: T;
}

export interface RitoCoreWasmRevisionReleaseResult {
  readonly releasedRevision: boolean;
  readonly releasedTransferCount: number;
}

export type RitoCoreWasmRevisionTransferRelease = RitoCoreWasmVersioned<number>;
export type RitoCoreWasmRevisionRelease = RitoCoreWasmVersioned<RitoCoreWasmRevisionReleaseResult>;

export interface RitoCoreWasmRevisionBundle {
  readonly revision: RitoCoreWasmRevisionSummary;
  readonly navigation: RitoCoreWasmRevisionNavigation;
  readonly tocTargets: RitoCoreWasmTocTargets;
  readonly footnotes: RitoCoreWasmFootnotes;
  readonly fontFamilies: readonly string[];
  readonly requiredFontFaces?: RitoCoreWasmRequiredFontFaces | undefined;
}

/**
 * Paint-ready metadata for one exact revision version.
 *
 * Unlike `RitoCoreWasmRevisionBundle`, this deliberately omits the
 * interaction aggregates (chapter text indices, publication-wide
 * footnotes) a visible snapshot does not need.
 */
export interface RitoCoreWasmRevisionPresentation {
  readonly revision: RitoCoreWasmRevisionSummary;
  readonly navigation: RitoCoreWasmRevisionNavigation;
  readonly tocTargets: RitoCoreWasmTocTargets;
  readonly fontFamilies: readonly string[];
  readonly requiredFontFaces?: RitoCoreWasmRequiredFontFaces | undefined;
}

export interface RitoCoreWasmRequiredFontFaces {
  readonly schemaVersion: 1;
  readonly revisionId: string;
  readonly faces: readonly RitoCoreWasmRequiredFontFace[];
}

export interface RitoCoreWasmRequiredFontFace {
  readonly family: string;
  readonly href: string;
  readonly style: 'normal' | 'italic' | 'oblique';
  readonly weight: number;
  readonly shapeFingerprint: string;
  readonly byteLength: number;
  readonly sourceOrder: number;
}

export interface RitoCoreWasmRevisionFrameSelection {
  readonly spreadIndex: number;
  readonly displaySpreadIndex: number;
}

export interface RitoCoreWasmChapterPageRange {
  readonly startPage: number;
  readonly endPage: number;
  readonly pageCount: number;
  readonly blockCount: number;
}

export interface RitoCoreWasmChapterNavigation {
  readonly idref: string;
  readonly href: string;
  readonly linear: boolean;
  readonly startPage?: number | undefined;
  readonly endPage?: number | undefined;
  readonly pageCount?: number | undefined;
}

export interface RitoCoreWasmSpreadNavigation {
  readonly spreadIndex: number;
  readonly pageIndexes: readonly number[];
  readonly leftPageIndex: number;
  readonly rightPageIndex?: number | undefined;
}

export interface RitoCoreWasmTocTargets {
  readonly revisionId: string;
  /** The entries this revision places on a page, in TOC order. */
  readonly targets: readonly RitoCoreWasmTocTarget[];
  /** Per page, the preorder index of the TOC entry the page reads under. */
  readonly activeEntryByPage: readonly (number | null)[];
}

export interface RitoCoreWasmTocTarget {
  /** Preorder index of the entry in the publication's TOC tree. */
  readonly tocIndex: number;
  readonly entry: RitoCoreWasmTocEntry;
  readonly pageIndex: number;
  readonly spreadIndex: number;
}

export interface RitoCoreWasmRevisionNavigation {
  readonly revisionId: string;
  readonly pageCount: number;
  readonly spreadCount: number;
  readonly spreads: readonly RitoCoreWasmSpreadNavigation[];
  readonly chapters: readonly RitoCoreWasmChapterNavigation[];
  readonly chapterMap: Readonly<Record<string, RitoCoreWasmChapterPageRange>>;
}
