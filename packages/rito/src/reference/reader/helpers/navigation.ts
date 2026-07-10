import {
  findActiveTocEntryForPage,
  findPageForTocEntry,
  findSpreadForPage,
  resolveTocEntryLocation,
} from '../../ts-core/runtime/navigation';
import type { EpubDocument } from '../../ts-core/runtime/types';
import type { TocEntry } from '../../ts-core/parser/epub/types';
import type { ReaderState } from './types';

interface ReaderNavigation {
  findPage(entry: TocEntry): number | undefined;
  findSpread(pageIndex: number): number | undefined;
  resolveTocEntry(entry: TocEntry): { pageIndex: number; spreadIndex: number } | undefined;
  findActiveTocEntry(pageIndex: number): TocEntry | undefined;
}

export function createReaderNavigation(
  doc: EpubDocument,
  state: ReaderState,
  manifestHrefs: ReadonlyMap<string, string>,
): ReaderNavigation {
  return {
    findPage: (entry: TocEntry) =>
      findPageForTocEntry(
        entry,
        state.resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
        state.resources.anchorMap,
        state.resources.chapterAnchorMap,
      ),
    findSpread: (pageIndex: number) => findSpreadForPage(pageIndex, state.spreads),
    resolveTocEntry: (entry: TocEntry) =>
      resolveTocEntryLocation(
        entry,
        state.resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
        state.spreads,
        state.resources.anchorMap,
        state.resources.chapterAnchorMap,
      ),
    findActiveTocEntry: (pageIndex: number) =>
      findActiveTocEntryForPage(
        doc.toc,
        pageIndex,
        state.resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
        state.resources.anchorMap,
        state.resources.chapterAnchorMap,
      ),
  };
}
