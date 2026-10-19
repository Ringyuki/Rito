import type { OverlayLayer, Rect } from '../../painter/types';
import type { HighlightColors } from './colors';

/** One annotation's rects on a spread, as it is marked. */
export interface AnnotationOverlay {
  readonly id: string;
  readonly rects: readonly Rect[];
  readonly color: string;
  readonly mark: 'fill' | 'underline';
}

/** Z-index constants for overlay layer ordering. */
const Z_ANNOTATION = 0;
const Z_SEARCH_MATCH = 1;
const Z_SEARCH_ACTIVE = 2;
const Z_SELECTION = 3;

export function mergeOverlayLayers(
  selectionRects: readonly Rect[],
  searchRects: readonly Rect[],
  activeSearchRects: readonly Rect[],
  annotationLayers: readonly AnnotationOverlay[],
  colors: HighlightColors,
): readonly OverlayLayer[] {
  const layers: OverlayLayer[] = [];

  for (const ann of annotationLayers) {
    if (ann.rects.length > 0) {
      layers.push({
        id: ann.id,
        rects: ann.rects,
        color: ann.color,
        zIndex: Z_ANNOTATION,
        mark: ann.mark,
      });
    }
  }

  if (searchRects.length > 0) {
    layers.push({
      id: 'search-match',
      rects: searchRects,
      color: colors.searchMatch,
      zIndex: Z_SEARCH_MATCH,
    });
  }

  if (activeSearchRects.length > 0) {
    layers.push({
      id: 'search-active',
      rects: activeSearchRects,
      color: colors.searchActive,
      zIndex: Z_SEARCH_ACTIVE,
    });
  }

  if (selectionRects.length > 0) {
    layers.push({
      id: 'selection',
      rects: selectionRects,
      color: colors.selection,
      zIndex: Z_SELECTION,
    });
  }

  return layers;
}
