import type { ComputedStyle, ListStyleType } from '../style/types';
import { LIST_STYLE_TYPES } from '../style/types';
import type { TextRun } from './types';

/** Width reserved for the marker area (px). */
const MARKER_AREA_WIDTH = 24;

/** Bullet character for unordered lists. */
const BULLET = '\u2022';

/** Format a list counter value based on the list style type. */
export function formatListMarker(counter: number, listStyleType: ListStyleType): string {
  if (listStyleType === LIST_STYLE_TYPES.Decimal) return `${String(counter)}.`;
  if (listStyleType === LIST_STYLE_TYPES.Disc) return BULLET;
  return '';
}

/**
 * Create a TextRun for a list marker, positioned in the padding area.
 *
 * @param counter - The 1-based item counter.
 * @param listStyleType - Bullet or number style.
 * @param style - The computed style of the list item (for font/color).
 * @param lineHeight - The height of the first line box.
 */
export function createMarkerRun(
  counter: number,
  listStyleType: ListStyleType,
  style: ComputedStyle,
  lineHeight: number,
): TextRun {
  const text = formatListMarker(counter, listStyleType);
  return {
    type: 'text-run',
    text,
    bounds: { x: -MARKER_AREA_WIDTH, y: 0, width: MARKER_AREA_WIDTH, height: lineHeight },
    style,
  };
}
