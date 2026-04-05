import type { Internals, ReaderProxiesSlice } from './types';

export function buildReaderProxies(internals: Internals): ReaderProxiesSlice {
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
      return internals.reader.spreads;
    },
    get pages() {
      return internals.reader.pages;
    },
    get currentSpread() {
      return internals.currentSpread;
    },
    get totalSpreads() {
      return internals.reader.totalSpreads;
    },
  };
}
