import type { RitoCoreWasmLayoutConfig, RitoCoreWasmLineBreaking } from './common';
import type { RitoCoreWasmChapterTextIndices, RitoCoreWasmFootnotes } from './interaction';
import type { RitoCoreWasmSourceLocator } from './interaction';
import type { RitoCoreWasmTocEntry } from './publication';
import type { RitoCoreWasmPlannedFrameResourcePrefetchResponse } from './resource';

export type RitoCoreWasmRevisionStatus = 'warming' | 'ready' | 'complete' | 'cancelled' | 'failed';

export interface RitoCoreWasmRevisionExtent {
  readonly pageCount: number;
  readonly spreadCount: number;
}

export interface RitoCoreWasmRevisionSummary {
  readonly revisionId: string;
  readonly revisionVersion: number;
  readonly layoutKey: string;
  readonly status: RitoCoreWasmRevisionStatus;
  readonly knownExtent: RitoCoreWasmRevisionExtent;
  readonly finalExtent?: RitoCoreWasmRevisionExtent | undefined;
  /** Backward-compatible alias for `knownExtent.pageCount`. */
  readonly pageCount: number;
  /** Backward-compatible alias for `knownExtent.spreadCount`. */
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

export interface RitoCoreWasmRevisionWorkBudget {
  /**
   * Maximum top-level source nodes accepted by one continuation quantum.
   * Rust separately meters transparent descendants and Greedy line boxes.
   */
  readonly maxTopLevelNodes: number;
}

export interface RitoCoreWasmBoundedRevisionRequest {
  readonly layoutConfig: RitoCoreWasmLayoutConfig;
  readonly lineBreaking?: RitoCoreWasmLineBreaking | undefined;
  readonly budget: RitoCoreWasmRevisionWorkBudget;
}

export interface RitoCoreWasmRevisionCursor extends RitoCoreWasmRevisionHandle {
  readonly cursor: string;
}

export interface RitoCoreWasmContinueRevisionRequest extends RitoCoreWasmRevisionHandle {
  readonly cursor: string;
  readonly budget: RitoCoreWasmRevisionWorkBudget;
}

export type RitoCoreWasmCancelRevisionRequest = RitoCoreWasmRevisionHandle;

export interface RitoCoreWasmRevisionPageRange {
  readonly startPage: number;
  readonly endPageExclusive: number;
}

export interface RitoCoreWasmRevisionAdvance {
  readonly revision: RitoCoreWasmRevisionSummary;
  readonly previousKnownExtent: RitoCoreWasmRevisionExtent;
  readonly newlyKnownPages: RitoCoreWasmRevisionPageRange;
  /**
   * Top-level source nodes accepted in this quantum. Line-only paragraph
   * continuation can report zero while still making deterministic progress.
   */
  readonly processedTopLevelNodes: number;
  readonly continuation?: RitoCoreWasmRevisionCursor | undefined;
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
  readonly chapterTextIndices: RitoCoreWasmChapterTextIndices;
  readonly fontFamilies: readonly string[];
  readonly fontVerticalMetricDemands?: readonly RitoCoreWasmFontVerticalMetricDemand[] | undefined;
  readonly requiredFontFaces?: RitoCoreWasmRequiredFontFaces | undefined;
}

/**
 * Paint-ready metadata for one exact revision version.
 *
 * Unlike `RitoCoreWasmRevisionBundle`, this deliberately omits cumulative
 * interaction aggregates so bounded growth does not retransmit chapter text
 * indices and publication-wide footnotes on every visible snapshot.
 */
export interface RitoCoreWasmRevisionPresentation {
  readonly revision: RitoCoreWasmRevisionSummary;
  readonly navigation: RitoCoreWasmRevisionNavigation;
  readonly tocTargets: RitoCoreWasmTocTargets;
  readonly fontFamilies: readonly string[];
  readonly fontVerticalMetricDemands?: readonly RitoCoreWasmFontVerticalMetricDemand[] | undefined;
  readonly requiredFontFaces?: RitoCoreWasmRequiredFontFaces | undefined;
}

export interface RitoCoreWasmFontVerticalMetricDemand {
  readonly fontFamily: string;
  readonly fontStyle: 'normal' | 'italic';
  readonly fontWeight: number;
  readonly fontSizePx: number;
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

export interface RitoCoreWasmInitialPreviewRevisionRequest {
  readonly layoutConfig: RitoCoreWasmLayoutConfig;
  readonly lineBreaking?: RitoCoreWasmLineBreaking | undefined;
}

export interface RitoCoreWasmFullRevisionBundleRequest {
  readonly layoutConfig: RitoCoreWasmLayoutConfig;
  readonly lineBreaking?: RitoCoreWasmLineBreaking | undefined;
  readonly activeSpreadIndex: number;
  readonly previousRevisionId?: string | undefined;
}

export interface RitoCoreWasmActiveChapterPreviewRevisionRequest {
  readonly layoutConfig: RitoCoreWasmLayoutConfig;
  readonly lineBreaking?: RitoCoreWasmLineBreaking | undefined;
  readonly previousRevisionId: string;
  readonly activeSpreadIndex: number;
}

export interface RitoCoreWasmPreviewRevisionBundleRequest {
  readonly layoutConfig: RitoCoreWasmLayoutConfig;
  readonly lineBreaking?: RitoCoreWasmLineBreaking | undefined;
  readonly previousRevisionId?: string | undefined;
  readonly activeSpreadIndex?: number | undefined;
}

export type RitoCoreWasmViewRevisionMode = 'preview' | 'full';
export type RitoCoreWasmViewRevisionKind = 'preview' | 'full';
export type RitoCoreWasmViewRevisionDisplay = 'revision' | 'visualPreview';

export interface RitoCoreWasmViewRevisionRequest {
  readonly layoutConfig: RitoCoreWasmLayoutConfig;
  readonly lineBreaking?: RitoCoreWasmLineBreaking | undefined;
  readonly activeSpreadIndex: number;
  readonly previousRevisionId?: string | undefined;
  /** Durable source identity to preserve while replacing the current revision. */
  readonly preserveLocator?: RitoCoreWasmSourceLocator | undefined;
  readonly mode: RitoCoreWasmViewRevisionMode;
}

export interface RitoCoreWasmViewRevisionFollowUp {
  readonly delayMs: number;
  readonly request: RitoCoreWasmViewRevisionRequest & {
    readonly mode: 'full';
    readonly previousRevisionId: string;
  };
}

export interface RitoCoreWasmRevisionFrameSelection {
  readonly spreadIndex: number;
  readonly displaySpreadIndex: number;
}

export interface RitoCoreWasmRevisionBundleResponse {
  readonly bundle: RitoCoreWasmRevisionBundle;
  readonly frameSelection?: RitoCoreWasmRevisionFrameSelection | undefined;
  readonly initialFrameWindow?: RitoCoreWasmPlannedFrameResourcePrefetchResponse | undefined;
  readonly preview: boolean;
  readonly releasedPreviousRevisionTransferCount: number;
}

export interface RitoCoreWasmViewRevisionResponse {
  readonly kind: RitoCoreWasmViewRevisionKind;
  readonly display: RitoCoreWasmViewRevisionDisplay;
  readonly followUp?: RitoCoreWasmViewRevisionFollowUp | undefined;
  readonly result: RitoCoreWasmRevisionBundleResponse;
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
  readonly targets: readonly RitoCoreWasmTocTarget[];
}

export interface RitoCoreWasmTocTarget {
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
