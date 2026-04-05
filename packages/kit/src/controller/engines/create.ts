import type { Reader } from 'rito';
import { createSelectionEngine } from 'rito/selection';
import { createSearchEngine } from 'rito/search';
import { createAnnotationEngine } from 'rito/annotations';
import { createPositionTracker } from 'rito/position';
import type { CoordinatorEngines } from '../core/coordinator-state';
import type { ControllerOptions } from '../types';

export function createEngines(reader: Reader, opts: ControllerOptions): CoordinatorEngines {
  const selection = createSelectionEngine();
  const search = createSearchEngine();
  const annotation = createAnnotationEngine();
  search.setPages(reader.pages);
  if (opts.annotationStorage) void annotation.init(opts.annotationStorage);
  const position = createPositionTracker(reader.spreads, reader.pages, reader.chapterMap);
  return { selection, search, annotation, position };
}
