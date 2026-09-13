import type { RitoCoreWasmChapterTextIndices, RitoCoreWasmFootnotes } from './types/interaction';
import type { RitoCoreWasmPublicationInfo, RitoCoreWasmTocEntry } from './types/publication';
import type { RitoCoreWasmRevisionNavigation, RitoCoreWasmTocTarget } from './types/revision';

/** A spread's navigation record keyed by `index` instead of `spreadIndex`. */
export interface RitoCoreWasmReaderSpread {
  readonly index: number;
  readonly pageIndexes: readonly number[];
  readonly leftPageIndex: number;
  readonly rightPageIndex?: number;
}

export interface RitoCoreWasmReaderChapterRange {
  readonly startPage: number;
  readonly endPage: number;
}

export function createRitoCoreWasmReaderManifestHrefMap(
  publication: RitoCoreWasmPublicationInfo,
): ReadonlyMap<string, string>;

export function createRitoCoreWasmReaderSpreads(
  navigation: RitoCoreWasmRevisionNavigation,
): readonly RitoCoreWasmReaderSpread[];

export function createRitoCoreWasmReaderChapterMap(
  navigation: RitoCoreWasmRevisionNavigation,
): ReadonlyMap<string, RitoCoreWasmReaderChapterRange>;

export function findRitoCoreWasmReaderTocTarget(
  targets: readonly RitoCoreWasmTocTarget[],
  entry: RitoCoreWasmTocEntry,
): RitoCoreWasmTocTarget | undefined;

export function findRitoCoreWasmReaderActiveTocEntry(
  targets: readonly RitoCoreWasmTocTarget[],
  pageIndex: number,
): RitoCoreWasmTocEntry | undefined;

export function findRitoCoreWasmReaderSpreadContainingPage(
  spreads: readonly RitoCoreWasmReaderSpread[],
  pageIndex: number,
): number | undefined;

export function createRitoCoreWasmReaderFootnoteMap(
  footnotes: RitoCoreWasmFootnotes,
): ReadonlyMap<string, RitoCoreWasmFootnotes['entries'][string]>;

export function createRitoCoreWasmReaderChapterTextIndexMap(
  indices: RitoCoreWasmChapterTextIndices,
): ReadonlyMap<string, RitoCoreWasmChapterTextIndices['entries'][string]>;
