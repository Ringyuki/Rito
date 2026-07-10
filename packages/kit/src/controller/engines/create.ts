import type { Reader } from '@ritojs/core';
import { createSelectionEngine } from '../../interaction/index';
import { createSearchEngine } from '../../interaction/index';
import { createAnnotationStore } from '../../interaction/index';
import type { AnnotationStore } from '../../interaction/index';
import { createPositionTracker } from '../../interaction/index';
import { asLegacyPages, asLegacySpreads } from '../compat/legacy-page';
import type { CoordinatorEngines, CoordinatorState } from '../core/coordinator-state';
import type { ControllerOptions } from '../types';

export function createEngines(
  reader: Reader,
  opts: ControllerOptions,
  coordState: CoordinatorState,
): CoordinatorEngines {
  const selection = createSelectionEngine();
  const search = createSearchEngine();
  search.setPages(asLegacyPages(reader.pages));

  const store = createAnnotationStore();
  coordState.annotationStore = store;
  if (opts.annotationStorage) void store.init(opts.annotationStorage);

  const position = createPositionTracker(() => ({
    spreads: asLegacySpreads(reader.spreads),
    pages: asLegacyPages(reader.pages),
    chapterMap: reader.chapterMap,
    manifestHrefMap: reader.manifestHrefMap,
    chapterTextIndices: reader.getChapterTextIndices(),
  }));
  return { selection, search, position };
}

/** Get the annotation store from coordinator state (convenience accessor). */
export function getAnnotationStore(coordState: CoordinatorState): AnnotationStore | null {
  return coordState.annotationStore;
}
