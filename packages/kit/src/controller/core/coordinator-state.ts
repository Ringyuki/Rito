import type { SelectionEngine } from 'rito/selection';
import type { SearchEngine } from 'rito/search';
import type { AnnotationEngine } from 'rito/annotations';
import type { PositionTracker } from 'rito/position';
import type { HitMap, LinkRegion } from 'rito/advanced';
import type { CoordinateMapper } from '../geometry/coordinate-mapper';

export interface CoordinatorEngines {
  readonly selection: SelectionEngine;
  readonly search: SearchEngine;
  readonly annotation: AnnotationEngine;
  readonly position: PositionTracker | null;
}

export interface CoordinatorState {
  hitMaps: Map<number, HitMap>;
  /** Link regions stored per-page (page-content coords). */
  linksByPage: Map<number, readonly LinkRegion[]>;
  /** Current coordinate mapper (rebuilt on each spread render). */
  mapper: CoordinateMapper | null;
}

export function createCoordinatorState(): CoordinatorState {
  return { hitMaps: new Map(), linksByPage: new Map(), mapper: null };
}
