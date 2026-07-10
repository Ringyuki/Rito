import { resolveLineWidth } from './line-width';
import type { KPItem, LineWidthSpec } from './types';

/** Greedy fallback used when the optimal solver cannot find a feasible path. */
export function emergencyBreaks(items: readonly KPItem[], lineWidth: LineWidthSpec): number[] {
  const positions: number[] = [];
  let currentWidth = 0;

  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    if (!item) continue;
    if (item.type === 'penalty' && item.penalty === -Infinity) {
      positions.push(index);
      currentWidth = 0;
      continue;
    }
    if (item.type === 'box') {
      currentWidth = emergencyBox(
        items,
        positions,
        index,
        item.width,
        currentWidth,
        resolveLineWidth(lineWidth, positions.length),
      );
    } else if (item.type === 'glue') {
      currentWidth += item.width;
    }
  }
  return positions;
}

function emergencyBox(
  items: readonly KPItem[],
  positions: number[],
  index: number,
  boxWidth: number,
  currentWidth: number,
  lineWidth: number,
): number {
  if (currentWidth + boxWidth <= lineWidth || currentWidth === 0) return currentWidth + boxWidth;

  const start = positions.length > 0 ? (positions[positions.length - 1] ?? 0) + 1 : 0;
  const breakPos = findBreakPosition(items, index, start);
  if (breakPos >= 0) {
    positions.push(breakPos);
    return widthAfterBreak(items, breakPos, index);
  }
  if (index > 0) {
    positions.push(index - 1);
    return boxWidth;
  }
  return currentWidth + boxWidth;
}

function findBreakPosition(items: readonly KPItem[], index: number, start: number): number {
  for (let cursor = index - 1; cursor >= start; cursor--) {
    const candidate = items[cursor];
    if (
      candidate?.type === 'glue' ||
      (candidate?.type === 'penalty' && isFinite(candidate.penalty))
    ) {
      return cursor;
    }
  }
  return -1;
}

function widthAfterBreak(items: readonly KPItem[], breakPos: number, end: number): number {
  let width = 0;
  for (let cursor = breakPos + 1; cursor <= end; cursor++) {
    const item = items[cursor];
    if (item && item.type !== 'penalty') width += item.width;
  }
  return width;
}
