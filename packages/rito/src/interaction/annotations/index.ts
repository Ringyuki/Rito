// Legacy geometry utilities — still exported via rito/advanced
export { resolveAnnotationRects } from './geometry';
export type { Annotation, AnnotationRenderData } from './geometry';

export type { AnnotationRecord, AnnotationDraft, AnnotationRecordPatch } from './model';
export { createAnnotationStore } from './store';
export type { AnnotationStore, RecordStorageAdapter } from './store';
export { resolveAnnotations } from './resolver';
export type {
  ResolvedAnnotation,
  ResolvedAnnotationSegment,
  ResolutionContext,
  ResolutionStatus,
} from './resolver';
export { resolveSourceRangeToSegments } from './source-to-page';
