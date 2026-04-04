export { buildHitMap, hitTest, resolveCharPosition } from './hit-map';
export { buildLinkMap, hitTestLink } from './link-map';
export { getSelectionRects, getSelectedText } from './selection';
export { buildSearchIndex, search } from './search-index';
export { buildSemanticTree } from './semantic-tree';
export { resolveAnnotationRects } from './annotations';
export { createReadingPosition, resolveReadingPosition } from './position';
export type { HitEntry, HitMap, LinkRegion, TextPosition, TextRange } from './types';
export type { SearchIndex, SearchResult, SearchOptions } from './search-index';
export type { SemanticNode, SemanticRole } from './semantic-tree';
export type { Annotation, AnnotationRenderData } from './annotations';
export type { ReadingPosition } from './position';
export { createSelectionEngine } from './selection-engine';
export type { SelectionEngine, SelectionState, PointerInput } from './selection-engine';
export { createSearchEngine } from './search-engine';
export type { SearchEngine } from './search-engine';
export { createAnnotationEngine } from './annotation-engine';
export type {
  AnnotationEngine,
  StorageAdapter,
  AnnotationInput,
  AnnotationPatch,
} from './annotation-engine';
export { createPositionTracker } from './position-tracker';
export type { PositionTracker } from './position-tracker';
