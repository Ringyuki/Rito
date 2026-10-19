import type { ReaderExactSourceRangeRequest, ReaderSourcePoint } from '@ritojs/core';
import type { Rect } from '../../painter/types';
import type { Internals, RangeGeometrySlice } from './types';

/** A relayout or turn while a range is read: it is read again, this many times at most. */
const RANGE_READS = 3;

export function buildRangeGeometry(
  internals: Internals,
  canvas: HTMLCanvasElement,
): RangeGeometrySlice {
  return {
    rangeRects(range) {
      return rangeRectsOnScreen(internals, canvas, range);
    },
  };
}

/**
 * The range's rects on the pages shown, in screen coordinates; a read the
 * layout or spread changed under is read again on the new one.
 */
async function rangeRectsOnScreen(
  internals: Internals,
  canvas: HTMLCanvasElement,
  range: ReaderExactSourceRangeRequest,
): Promise<readonly Rect[]> {
  const { coordState } = internals;
  for (let read = 0; read < RANGE_READS; read += 1) {
    const interactions = internals.reader.interactions;
    if (!coordState.nativeInteractionsAlive || !interactions?.enabled) return [];
    if (!interactions.resolveExactSourceRange) return [];
    const generation = coordState.nativeTargetLoadGeneration;
    const resolution = await interactions.resolveExactSourceRange({
      href: range.href,
      sourceRange: {
        start: copyPoint(range.sourceRange.start),
        end: copyPoint(range.sourceRange.end),
      },
    });
    if (generation !== coordState.nativeTargetLoadGeneration) continue;
    const { mapper } = coordState;
    if (resolution?.status !== 'resolved' || !mapper) return [];
    const bounds = canvas.getBoundingClientRect();
    return resolution.range.rects
      .filter((rect) => mapper.isPageVisible(rect.pageIndex))
      .map((rect) => mapper.pageContentToScreen(rect.pageIndex, rect, bounds));
  }
  return [];
}

function copyPoint(point: ReaderSourcePoint): ReaderSourcePoint {
  return { nodePath: [...point.nodePath], textOffset: point.textOffset };
}
