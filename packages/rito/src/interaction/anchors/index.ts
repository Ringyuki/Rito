// Annotation anchor system — source-anchored selectors for stable annotation persistence.

export type {
  SourcePoint,
  SourceRangeSelector,
  TextQuoteSelector,
  TextPositionSelector,
  ProgressionSelector,
  AnnotationSelectors,
  AnnotationTarget,
  LocatorTextContext,
} from './model';

export {
  type ChapterTextIndex,
  type ChapterTextSpan,
  buildChapterTextIndex,
} from './chapter-text-index';
export { sourcePointToOffset, offsetToSourcePoint } from './source-point';
export { createTextQuoteSelector, resolveTextQuoteSelector } from './quote-match';
export { createTextPositionSelector, resolveTextPositionSelector } from './text-position';
export { createProgressionSelector, resolveProgressionSelector } from './progression';
export { createAnnotationTarget, type CreateTargetInput } from './create';
