import type { BrowserReaderState } from './reader/types';

/**
 * Moves where a sharded publication's image shards are supplied ahead of
 * need from: the chapter the spread at `spreadIndex` opens with. The worker
 * client supplies them one at a time while the reader is idle; for a
 * publication opened from an archive there is nothing to do.
 */
export function prefetchBrowserReaderShardsNear(
  state: BrowserReaderState,
  spreadIndex: number,
): void {
  if (state.documentData instanceof ArrayBuffer) return;
  const navigation = state.revisionBundle.navigation;
  const page = navigation.spreads[spreadIndex]?.pageIndexes[0];
  if (page === undefined) return;
  const chapter = navigation.chapters.find(
    (candidate) =>
      candidate.startPage !== undefined &&
      candidate.endPage !== undefined &&
      page >= candidate.startPage &&
      page < candidate.endPage,
  );
  if (!chapter) return;
  state.worker.prefetchShardsNear(chapter.href).catch((error: unknown) => {
    state.logger.warn('reader shard prefetch could not be ordered', error);
  });
}
