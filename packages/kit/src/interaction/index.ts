export {
  buildHitMap,
  buildLinkMap,
  buildSemanticTree,
  hitTest,
  hitTestLink,
  resolveCharPosition,
} from './core';
export type {
  HitEntry,
  HitMap,
  LinkRegion,
  SemanticNode,
  SemanticRole,
  TextPosition,
  TextRange,
} from './core';

export { createSelectionEngine, getSelectedText, getSelectionRects } from './selection';
export type {
  PagedPosition,
  PointerInput,
  SelectionEngine,
  SelectionSnapshot,
  SelectionState,
} from './selection';

export { buildSearchIndex, createSearchEngine, search } from './search';
export type { SearchEngine, SearchIndex, SearchOptions, SearchResult } from './search';

export {
  createAnnotationStore,
  resolveAnnotations,
  resolveSourceRangeToSegments,
} from './annotations';
export type {
  AnnotationDraft,
  AnnotationRecord,
  AnnotationRecordPatch,
  AnnotationStore,
  RecordStorageAdapter,
  ResolvedAnnotation,
  ResolvedAnnotationSegment,
  ResolutionContext,
  ResolutionStatus,
} from './annotations';
export {
  buildChapterTextIndex,
  createAnnotationTarget,
  offsetToSourcePoint,
  sourcePointToOffset,
} from './anchors';
export type {
  AnnotationTarget,
  ChapterTextIndex,
  ChapterTextSpan,
  CreateTargetFromOffsetsInput,
  SourcePoint,
  SourceRangeSelector,
} from './anchors';

export {
  createPositionTracker,
  createReadingPosition,
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

export { createA11yMirror } from './dom/a11y-mirror';
export type { A11yMirror } from './dom/a11y-mirror';
export { bindClipboard } from './dom/clipboard';
export { bindLinkCursor } from './dom/link-cursor';
export { bindPointerEvents } from './dom/pointer-events';

export type {
  DocumentNode,
  ImageElement,
  InlineAtom,
  LayoutBlock,
  LayoutConfig,
  LineBox,
  Page,
  Rect,
  SourceRef,
  Spread,
  TextMeasurer,
  TextRun,
} from './layout-types';
export { DEFAULT_RUN_PAINT } from './layout-types';
