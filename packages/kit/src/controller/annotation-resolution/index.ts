export { buildChapterTextIndexFromHitMaps } from './chapter-index-builder';
export { resolveVisibleAnnotations } from './resolve-visible';
export {
  createNativeAnnotationGeometryState,
  invalidateNativeAnnotationGeometry,
  refreshNativeAnnotations,
  scheduleNativeAnnotationsForSpread,
  usesNativeAnnotationGeometry,
  type NativeAnnotationGeometryState,
} from './native-geometry';
export { syncChapterIndices } from './sync-chapter-indices';
export { buildChapterPageRanges } from './chapter-identity';
export {
  buildAnnotationTargetFromLocator,
  buildAnnotationTargetFromSnapshot,
} from './target-builder';
