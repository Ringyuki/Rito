import type { Reader } from '@rito/core';
import { createSelectionEngine } from '@rito/core/selection';
import { createSearchEngine } from '@rito/core/search';
import { createAnnotationStore } from '@rito/core/annotations';
import type { AnnotationStore } from '@rito/core/annotations';
import { createPositionTracker } from '@rito/core/position';
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
