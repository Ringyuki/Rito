export { createSelectionEngine } from './selection';
export type {
  PointerInput,
  SelectionEngine,
  SelectionGranularity,
  SelectionState,
} from './selection';

export { createSearchEngine } from './search';
export type { SearchEngine, SearchOptions, SearchResult } from './search';

export { createAnnotationStore } from './annotations';
export type {
  AnnotationDraft,
  AnnotationRecord,
  AnnotationRecordPatch,
  AnnotationStore,
  RecordStorageAdapter,
  ResolvedAnnotation,
  ResolvedAnnotationSegment,
  ResolutionStatus,
} from './annotations';
export { createAnnotationTarget, offsetToSourcePoint, sourcePointToOffset } from './anchors';
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
  parseReadingPosition,
  projectReadingPosition,
  resolveReadingPosition,
} from './position';
export type {
  PositionLayout,
  PositionIntent,
  PositionProjection,
  PositionTracker,
  ReadingLocator,
  ReadingPosition,
} from './position';

export { createA11yMirror } from './dom/a11y-mirror';
export type { A11yMirror, A11yMirrorOptions } from './dom/a11y-mirror';
export { bindClipboard } from './dom/clipboard';

export type { LayoutConfig, Rect } from './layout-types';
