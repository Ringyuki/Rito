import type { Page, Rect } from '../../layout/core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { ComputedStyle } from '../../style/core/types';
import { measurePaintFromStyle } from '../../style/css/font-shorthand';
import type { HitMap, TextPosition, TextRange } from '../core/types';
import { isSameTextRun, normalizeTextRange, walkPageTextRuns } from '../core/text-traversal';

/**
 * Compute highlight rectangles for a text selection range.
 * Returns one rectangle per line covered by the selection.
 */
export function getSelectionRects(
  hitMap: HitMap,
  range: TextRange,
  measurer: TextMeasurer,
): readonly Rect[] {
  const rects: Rect[] = [];
  const [start, end] = normalizeTextRange(range);
  let inRange = false;

  for (const entry of hitMap.entries) {
    const pos = {
      blockIndex: entry.blockIndex,
      lineIndex: entry.lineIndex,
      runIndex: entry.runIndex,
    };
    const isStart = sameRun(pos, start);
    const isEnd = sameRun(pos, end);

    if (isStart && isEnd) {
      rects.push(sliceRunRect(entry, start.charIndex, end.charIndex, measurer));
      break;
    }
    if (isStart) {
      inRange = true;
      rects.push(sliceRunRect(entry, start.charIndex, entry.text.length, measurer));
      continue;
    }
    if (isEnd) {
      rects.push(sliceRunRect(entry, 0, end.charIndex, measurer));
      break;
    }
    if (inRange) {
      rects.push(entry.bounds);
    }
  }

  return mergeLineRects(rects);
}

/** Extract the plain text within a selection range from a page. */
export function getSelectedText(page: Page, range: TextRange): string {
  const [start, end] = normalizeTextRange(range);
  const parts: string[] = [];
  let inRange = false;

  walkPageTextRuns(page, ({ run, blockIndex, lineIndex, runIndex }) => {
    const isStart = isSameTextRun({ blockIndex, lineIndex, runIndex }, start);
    const isEnd = isSameTextRun({ blockIndex, lineIndex, runIndex }, end);

    if (isStart && isEnd) {
      parts.push(run.text.slice(start.charIndex, end.charIndex));
      return true;
    }
    if (isStart) {
      inRange = true;
      parts.push(run.text.slice(start.charIndex));
      return false;
    }
    if (isEnd) {
      parts.push(run.text.slice(0, end.charIndex));
      return true;
    }
    if (inRange) parts.push(run.text);
    return false;
  });

  return parts.join('');
}

function sameRun(
  pos: { blockIndex: number; lineIndex: number; runIndex: number },
  target: TextPosition,
): boolean {
  return isSameTextRun(pos, target);
}

function sliceRunRect(
  entry: { bounds: Rect; text: string; style: { fontSize: number } },
  from: number,
  to: number,
  measurer: TextMeasurer,
): Rect {
  if (from === 0 && to >= entry.text.length) return entry.bounds;

  // HitEntry.style still holds a full ComputedStyle (Phase 2 will slim it
  // to MeasurePaint). Derive the measurer's paint subset lazily here.
  const paint = measurePaintFromStyle(entry.style as ComputedStyle);
  const startX = from > 0 ? measurer.measureText(entry.text.slice(0, from), paint).width : 0;
  const endX = measurer.measureText(entry.text.slice(0, to), paint).width;
  return {
    x: entry.bounds.x + startX,
    y: entry.bounds.y,
    width: endX - startX,
    height: entry.bounds.height,
  };
}

/** Merge adjacent rects on the same y into wider rects (one per line). */
function mergeLineRects(rects: readonly Rect[]): Rect[] {
  if (rects.length === 0) return [];
  const merged: Rect[] = [];
  let current = rects[0];
  if (!current) return [];

  for (let i = 1; i < rects.length; i++) {
    const next = rects[i];
    if (!next) continue;
    if (next.y === current.y) {
      const x = Math.min(current.x, next.x);
      const right = Math.max(current.x + current.width, next.x + next.width);
      current = { x, y: current.y, width: right - x, height: current.height };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}
