import type { Reader } from 'rito';
import { createSelectionEngine } from 'rito/selection';
import { createSearchEngine } from 'rito/search';
import { createAnnotationStore } from 'rito/annotations';
import type { AnnotationStore } from 'rito/annotations';
import { createPositionTracker } from 'rito/position';
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
