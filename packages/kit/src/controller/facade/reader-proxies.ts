import { publishedSpread, showsChapterAlone } from '../core/spread-change';
import type { Emitter, Internals, ReaderProxiesSlice } from './types';

/**
 * The reader as a host sees it. Spread indexes and counts are book-wide:
 * while the reader's layout covers only the chapter being read, they stay
 * what the last `layoutChange` and `spreadChange` said.
 */
export function buildReaderProxies(internals: Internals, emitter: Emitter): ReaderProxiesSlice {
  const chapterAlone = (): boolean => showsChapterAlone(internals.reader);
  return {
    get reader() {
      return internals.reader;
    },
    get metadata() {
      return internals.reader.metadata;
    },
    get toc() {
      return internals.reader.toc;
    },
    get spreads() {
      if (chapterAlone()) return internals.coordState.publishedLayout?.spreads ?? [];
      return internals.reader.spreads;
    },
    get currentSpread() {
      return chapterAlone() ? (publishedSpread(emitter) ?? 0) : internals.currentSpread;
    },
    get totalSpreads() {
      if (chapterAlone()) return internals.coordState.publishedLayout?.totalSpreads ?? 0;
      return internals.reader.totalSpreads;
    },
  };
}
