export { buildHitMap, hitTest, resolveCharPosition, buildLinkMap, hitTestLink } from './core';
export { buildSemanticTree } from './core';
export type { HitEntry, HitMap, LinkRegion, TextPosition, TextRange } from './core';
export type { SemanticNode, SemanticRole } from './core';
export { getSelectionRects, getSelectedText, createSelectionEngine } from './selection';
export type { SelectionEngine, SelectionState, PointerInput } from './selection';
export { buildSearchIndex, search, createSearchEngine } from './search';
export type { SearchIndex, SearchResult, SearchOptions, SearchEngine } from './search';
export { resolveAnnotationRects } from './annotations';
export type { Annotation, AnnotationRenderData } from './annotations';
export {
  createReadingPosition,
  createPositionTracker,
  projectReadingPosition,
  resolveReadingPosition,
} from './position';
export type {
  PositionLayout,
  PositionProjection,
  PositionTracker,
  ReadingLocator,
  ReadingPosition,
} from './position';
