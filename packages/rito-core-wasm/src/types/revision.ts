import type { RitoCoreWasmLayoutConfig, RitoCoreWasmLineBreaking } from './common';
import type { RitoCoreWasmChapterTextIndices, RitoCoreWasmFootnotes } from './interaction';
import type { RitoCoreWasmTocEntry } from './publication';
import type { RitoCoreWasmPlannedFrameResourcePrefetchResponse } from './resource';

export interface RitoCoreWasmRevisionSummary {
  readonly revisionId: string;
  readonly layoutKey: string;
  readonly pageCount: number;
  readonly spreadCount: number;
}

export interface RitoCoreWasmRevisionBundle {
  readonly revision: RitoCoreWasmRevisionSummary;
  readonly navigation: RitoCoreWasmRevisionNavigation;
  readonly tocTargets: RitoCoreWasmTocTargets;
  readonly footnotes: RitoCoreWasmFootnotes;
  readonly chapterTextIndices: RitoCoreWasmChapterTextIndices;
  readonly fontFamilies: readonly string[];
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
