import {
  findActiveTocEntryForPage,
  findPageForTocEntry,
  findSpreadForPage,
  resolveTocEntryLocation,
} from '../../runtime/navigation';
import type { EpubDocument } from '../../runtime/types';
import type { TocEntry } from '../../parser/epub/types';
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
      ),
    findSpread: (pageIndex: number) => findSpreadForPage(pageIndex, state.spreads),
    resolveTocEntry: (entry: TocEntry) =>
      resolveTocEntryLocation(
        entry,
        state.resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
        state.spreads,
      ),
    findActiveTocEntry: (pageIndex: number) =>
      findActiveTocEntryForPage(
        doc.toc,
        pageIndex,
        state.resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
      ),
  };
}
