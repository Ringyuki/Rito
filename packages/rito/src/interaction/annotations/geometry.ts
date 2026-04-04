import type { Rect } from '../../layout/core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { HitMap, TextRange } from '../core/types';
import { getSelectionRects } from '../selection/range';

/** A user annotation on the text. */
export interface Annotation {
  readonly id: string;
  readonly type: 'highlight' | 'underline' | 'note';
  readonly range: TextRange;
  readonly pageIndex: number;
  readonly color?: string;
  readonly note?: string;
  readonly createdAt: number;
}

/** Resolved annotation with render-ready rectangles. */
export interface AnnotationRenderData {
  readonly annotation: Annotation;
  readonly rects: readonly Rect[];
}

/**
 * Resolve an annotation's text range into canvas-coordinate rectangles.
 * Reuses the selection geometry engine.
 */
export function resolveAnnotationRects(
  annotation: Annotation,
  hitMap: HitMap,
  measurer: TextMeasurer,
): AnnotationRenderData {
  const rects = getSelectionRects(hitMap, annotation.range, measurer);
  return { annotation, rects };
}
