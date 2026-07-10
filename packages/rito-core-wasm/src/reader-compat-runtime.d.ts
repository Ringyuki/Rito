import type { RitoCoreWasmLayoutConfig } from './types/common';
import type { RitoCoreWasmChapterTextIndices, RitoCoreWasmFootnotes } from './types/interaction';
import type { RitoCoreWasmPublicationInfo, RitoCoreWasmTocEntry } from './types/publication';
import type { RitoCoreWasmRevisionNavigation, RitoCoreWasmTocTarget } from './types/revision';

export interface RitoCoreWasmReaderCompatRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RitoCoreWasmReaderCompatPage {
  readonly index: number;
  readonly bounds: RitoCoreWasmReaderCompatRect;
  readonly content: readonly unknown[];
}

export interface RitoCoreWasmReaderCompatSpread {
  readonly index: number;
  readonly left?: RitoCoreWasmReaderCompatPage;
  readonly right?: RitoCoreWasmReaderCompatPage;
}

export interface RitoCoreWasmReaderCompatChapterRange {
  readonly startPage: number;
  readonly endPage: number;
}

export function createRitoCoreWasmReaderManifestHrefMap(
  publication: RitoCoreWasmPublicationInfo,
): ReadonlyMap<string, string>;

export function createRitoCoreWasmReaderPages(
  pageCount: number,
  config: RitoCoreWasmLayoutConfig,
): readonly RitoCoreWasmReaderCompatPage[];

export function createRitoCoreWasmReaderSpreads(
  pages: readonly RitoCoreWasmReaderCompatPage[],
  navigation: RitoCoreWasmRevisionNavigation,
): readonly RitoCoreWasmReaderCompatSpread[];

export function createRitoCoreWasmReaderChapterMap(
  navigation: RitoCoreWasmRevisionNavigation,
): ReadonlyMap<string, RitoCoreWasmReaderCompatChapterRange>;

export function findRitoCoreWasmReaderTocTarget(
  targets: readonly RitoCoreWasmTocTarget[],
  entry: RitoCoreWasmTocEntry,
): RitoCoreWasmTocTarget | undefined;

export function findRitoCoreWasmReaderActiveTocEntry(
  targets: readonly RitoCoreWasmTocTarget[],
  pageIndex: number,
): RitoCoreWasmTocEntry | undefined;

export function findRitoCoreWasmReaderSpreadContainingPage(
  spreads: readonly RitoCoreWasmReaderCompatSpread[],
  pageIndex: number,
): number | undefined;

export function createRitoCoreWasmReaderFootnoteMap(
  footnotes: RitoCoreWasmFootnotes,
): ReadonlyMap<string, RitoCoreWasmFootnotes['entries'][string]>;

export function createRitoCoreWasmReaderChapterTextIndexMap(
  indices: RitoCoreWasmChapterTextIndices,
): ReadonlyMap<string, RitoCoreWasmChapterTextIndices['entries'][string]>;
