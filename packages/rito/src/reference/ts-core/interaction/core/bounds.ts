import type { Rect } from '../../layout/core/types';

/** Translate bounds by an offset. */
export function offsetBounds(b: Rect, offsetX: number, offsetY: number): Rect {
  return { x: offsetX + b.x, y: offsetY + b.y, width: b.width, height: b.height };
}
