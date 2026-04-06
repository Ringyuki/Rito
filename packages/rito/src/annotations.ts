export type {
  AnnotationRecord,
  AnnotationDraft,
  AnnotationRecordPatch,
} from './interaction/annotations';
export { createAnnotationStore } from './interaction/annotations';
export type { AnnotationStore, RecordStorageAdapter } from './interaction/annotations';
export { resolveAnnotations } from './interaction/annotations';
export type {
  ResolvedAnnotation,
  ResolvedAnnotationSegment,
  ResolutionContext,
  ResolutionStatus,
} from './interaction/annotations';
export { resolveSourceRangeToSegments } from './interaction/annotations';

// anchor types for target creation and resolution
export { createAnnotationTarget } from './interaction/anchors/create';
export type { CreateTargetFromOffsetsInput } from './interaction/anchors/create';
export { sourcePointToOffset, offsetToSourcePoint } from './interaction/anchors/source-point';
export { buildChapterTextIndex } from './interaction/anchors/chapter-text-index';
export type { ChapterTextIndex, ChapterTextSpan } from './interaction/anchors/chapter-text-index';
export type {
  AnnotationTarget,
  AnnotationSelectors,
  SourcePoint,
  SourceRangeSelector,
} from './interaction/anchors/model';
