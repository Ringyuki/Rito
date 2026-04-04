import type { OverlayLayer, Rect } from '../overlay/types';

/** Z-index constants for overlay layer ordering. */
const Z_ANNOTATION = 0;
const Z_SEARCH_MATCH = 1;
const Z_SEARCH_ACTIVE = 2;
const Z_SELECTION = 3;

export const OVERLAY_COLORS = {
  selection: 'rgba(59, 130, 246, 0.3)',
  searchMatch: 'rgba(250, 204, 21, 0.4)',
  searchActive: 'rgba(249, 115, 22, 0.6)',
  annotationDefault: 'rgba(250, 204, 21, 0.3)',
} as const;

export function mergeOverlayLayers(
  selectionRects: readonly Rect[],
  searchRects: readonly Rect[],
  activeSearchRects: readonly Rect[],
  annotationLayers: readonly { id: string; rects: readonly Rect[]; color: string }[],
): readonly OverlayLayer[] {
  const layers: OverlayLayer[] = [];

  for (const ann of annotationLayers) {
    if (ann.rects.length > 0) {
      layers.push({ id: ann.id, rects: ann.rects, color: ann.color, zIndex: Z_ANNOTATION });
    }
  }

  if (searchRects.length > 0) {
    layers.push({
      id: 'search-match',
      rects: searchRects,
      color: OVERLAY_COLORS.searchMatch,
      zIndex: Z_SEARCH_MATCH,
    });
  }

  if (activeSearchRects.length > 0) {
    layers.push({
      id: 'search-active',
      rects: activeSearchRects,
      color: OVERLAY_COLORS.searchActive,
      zIndex: Z_SEARCH_ACTIVE,
    });
  }

  if (selectionRects.length > 0) {
    layers.push({
      id: 'selection',
      rects: selectionRects,
      color: OVERLAY_COLORS.selection,
      zIndex: Z_SELECTION,
    });
  }

  return layers;
}
