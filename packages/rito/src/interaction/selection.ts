import type { LayoutBlock, LineBox, Page, Rect, TextRun } from '../layout/core/types';
import type { TextMeasurer } from '../layout/text/text-measurer';
import type { HitMap, TextPosition, TextRange } from './types';

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
  const [start, end] = normalizeRange(range);
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
  const [start, end] = normalizeRange(range);
  const parts: string[] = [];
  let inRange = false;

  walkTextRuns(page, (run, blockIndex, lineIndex, runIndex) => {
    const pos = { blockIndex, lineIndex, runIndex };
    const isStart = sameRun(pos, start);
    const isEnd = sameRun(pos, end);

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

function normalizeRange(range: TextRange): [TextPosition, TextPosition] {
  if (comparePositions(range.start, range.end) <= 0) return [range.start, range.end];
  return [range.end, range.start];
}

function comparePositions(a: TextPosition, b: TextPosition): number {
  if (a.blockIndex !== b.blockIndex) return a.blockIndex - b.blockIndex;
  if (a.lineIndex !== b.lineIndex) return a.lineIndex - b.lineIndex;
  if (a.runIndex !== b.runIndex) return a.runIndex - b.runIndex;
  return a.charIndex - b.charIndex;
}

function sameRun(
  pos: { blockIndex: number; lineIndex: number; runIndex: number },
  target: TextPosition,
): boolean {
  return (
    pos.blockIndex === target.blockIndex &&
    pos.lineIndex === target.lineIndex &&
    pos.runIndex === target.runIndex
  );
}

function sliceRunRect(
  entry: { bounds: Rect; text: string; style: { fontSize: number } },
  from: number,
  to: number,
  measurer: TextMeasurer,
): Rect {
  if (from === 0 && to >= entry.text.length) return entry.bounds;

  const style = entry.style as Parameters<TextMeasurer['measureText']>[1];
  const startX = from > 0 ? measurer.measureText(entry.text.slice(0, from), style).width : 0;
  const endX = measurer.measureText(entry.text.slice(0, to), style).width;
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

function walkTextRuns(
  page: Page,
  callback: (run: TextRun, blockIndex: number, lineIndex: number, runIndex: number) => boolean,
): void {
  for (let bi = 0; bi < page.content.length; bi++) {
    const block = page.content[bi];
    if (block && walkBlock(block, bi, callback)) return;
  }
}

function walkBlock(
  block: LayoutBlock,
  blockIndex: number,
  callback: (run: TextRun, blockIndex: number, lineIndex: number, runIndex: number) => boolean,
): boolean {
  for (let li = 0; li < block.children.length; li++) {
    const child = block.children[li];
    if (!child || child.type !== 'line-box') continue;
    if (walkLine(child, blockIndex, li, callback)) return true;
  }
  return false;
}

function walkLine(
  lineBox: LineBox,
  blockIndex: number,
  lineIndex: number,
  callback: (run: TextRun, blockIndex: number, lineIndex: number, runIndex: number) => boolean,
): boolean {
  for (let ri = 0; ri < lineBox.runs.length; ri++) {
    const run = lineBox.runs[ri];
    if (run?.type === 'text-run' && callback(run, blockIndex, lineIndex, ri)) return true;
  }
  return false;
}
