import type { LayoutBlock, Rect } from '../../layout/core/types';
import type { ResolvedRadius } from './types';

export function absoluteRect(rect: Rect, offsetX: number, offsetY: number): Rect {
  return { x: offsetX + rect.x, y: offsetY + rect.y, width: rect.width, height: rect.height };
}

export function resolveBlockRadius(block: LayoutBlock): ResolvedRadius {
  const radius = block.paint?.radius;
  if (!radius) return { rx: 0, ry: 0 };
  if (radius.pct !== undefined) {
    return {
      rx: (radius.pct / 100) * block.bounds.width,
      ry: (radius.pct / 100) * block.bounds.height,
    };
  }
  const r = radius.px ?? 0;
  return { rx: r, ry: r };
}
