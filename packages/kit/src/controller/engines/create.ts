import type { Reader } from '@ritojs/core';
import { createSelectionEngine } from '@ritojs/core/selection';
import { createSearchEngine } from '@ritojs/core/search';
import { createAnnotationStore } from '@ritojs/core/annotations';
import type { AnnotationStore } from '@ritojs/core/annotations';
import { createPositionTracker } from '@ritojs/core/position';
import type { CoordinatorEngines, CoordinatorState } from '../core/coordinator-state';
import type { ControllerOptions } from '../types';

export function createEngines(
  reader: Reader,
  opts: ControllerOptions,
  coordState: CoordinatorState,
): CoordinatorEngines {
  const selection = createSelectionEngine();
  const search = createSearchEngine();
  search.setPages(reader.pages);

  const store = createAnnotationStore();
  coordState.annotationStore = store;
  if (opts.annotationStorage) void store.init(opts.annotationStorage);

  const position = createPositionTracker(reader.spreads, reader.pages, reader.chapterMap);
  return { selection, search, position };
}

/** Get the annotation store from coordinator state (convenience accessor). */
export function getAnnotationStore(coordState: CoordinatorState): AnnotationStore | null {
  return coordState.annotationStore;
}
