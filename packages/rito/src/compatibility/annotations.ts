export type {
  AnnotationRecord,
  AnnotationDraft,
  AnnotationRecordPatch,
} from '../reference/ts-core/interaction/annotations';
export { createAnnotationStore } from '../reference/ts-core/interaction/annotations';
export type {
  AnnotationStore,
  RecordStorageAdapter,
} from '../reference/ts-core/interaction/annotations';
export { resolveAnnotations } from '../reference/ts-core/interaction/annotations';
export type {
  ResolvedAnnotation,
  ResolvedAnnotationSegment,
  ResolutionContext,
  ResolutionStatus,
} from '../reference/ts-core/interaction/annotations';
export { resolveSourceRangeToSegments } from '../reference/ts-core/interaction/annotations';

// anchor types for target creation and resolution
export { createAnnotationTarget } from '../reference/ts-core/interaction/anchors/create';
export type { CreateTargetFromOffsetsInput } from '../reference/ts-core/interaction/anchors/create';
export {
  sourcePointToOffset,
  offsetToSourcePoint,
} from '../reference/ts-core/interaction/anchors/source-point';
export { buildChapterTextIndex } from '../reference/ts-core/interaction/anchors/chapter-text-index';
export type {
  ChapterTextIndex,
  ChapterTextSpan,
} from '../reference/ts-core/interaction/anchors/chapter-text-index';
export type {
  AnnotationTarget,
  AnnotationSelectors,
  SourcePoint,
  SourceRangeSelector,
} from '../reference/ts-core/interaction/anchors/model';
