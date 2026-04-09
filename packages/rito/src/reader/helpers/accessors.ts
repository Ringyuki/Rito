import type { EpubDocument } from '../../runtime/types';
import type { ReaderState } from './types';

export function defineReaderAccessors(
  state: ReaderState,
  doc: EpubDocument,
  manifestHrefMap: ReadonlyMap<string, string>,
): object {
  return Object.defineProperties(
    {},
    {
      metadata: { get: () => doc.packageDocument.metadata, enumerable: true },
      totalSpreads: { get: () => state.spreads.length, enumerable: true },
      toc: { get: () => doc.toc, enumerable: true },
      chapterMap: { get: () => state.resources.chapterMap, enumerable: true },
      manifestHrefMap: { get: () => manifestHrefMap, enumerable: true },
      pages: { get: () => state.resources.pages, enumerable: true },
      spreads: { get: () => state.spreads, enumerable: true },
      dpr: { get: () => state.dpr, enumerable: true },
    },
  );
}
