import type { InlineAtom, LayoutBlock, LineBox, Page, TextRun } from '../layout/core/types';
import type { ComputedStyle } from '../style/core/types';
import type { TextMeasurer } from '../layout/text/text-measurer';
import type { HitEntry, HitMap, TextPosition } from './types';

/** Build a HitMap from a page's layout data. Collects all text runs with absolute bounds. */
export function buildHitMap(page: Page): HitMap {
  const entries: HitEntry[] = [];
  for (let bi = 0; bi < page.content.length; bi++) {
    const block = page.content[bi];
    if (block) collectBlock(entries, block, 0, 0, bi);
  }
  return { entries, pageIndex: page.index };
}

/** Find the HitEntry at the given page-local coordinates. */
export function hitTest(hitMap: HitMap, x: number, y: number): HitEntry | undefined {
  // Binary search on y to narrow candidates, then linear scan on x.
  let best: HitEntry | undefined;
  let bestDist = Infinity;

  for (const entry of hitMap.entries) {
    if (y < entry.bounds.y || y > entry.bounds.y + entry.bounds.height) continue;
    if (x >= entry.bounds.x && x <= entry.bounds.x + entry.bounds.width) return entry;
    const dx = x < entry.bounds.x ? entry.bounds.x - x : x - entry.bounds.x - entry.bounds.width;
    if (dx < bestDist) {
      bestDist = dx;
      best = entry;
    }
  }
  return best;
}

/**
 * Resolve a precise character position from page-local coordinates.
 * Uses the measurer to subdivide a matched TextRun for char-level accuracy.
 */
export function resolveCharPosition(
  hitMap: HitMap,
  x: number,
  y: number,
  measurer: TextMeasurer,
): TextPosition | undefined {
  const entry = hitTest(hitMap, x, y);
  if (!entry || entry.text.length === 0) return undefined;

  const localX = x - entry.bounds.x;
  const charIndex = findCharIndex(entry.text, entry.bounds.width, localX, measurer, entry.style);
  return {
    blockIndex: entry.blockIndex,
    lineIndex: entry.lineIndex,
    runIndex: entry.runIndex,
    charIndex,
  };
}

function findCharIndex(
  text: string,
  totalWidth: number,
  targetX: number,
  measurer: TextMeasurer,
  style: ComputedStyle,
): number {
  if (targetX <= 0) return 0;
  if (targetX >= totalWidth) return text.length;

  // Binary search for the character boundary closest to targetX.
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const w = measurer.measureText(text.slice(0, mid + 1), style).width;
    if (w <= targetX) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function collectBlock(
  entries: HitEntry[],
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
  blockIndex: number,
): void {
  const bx = offsetX + block.bounds.x;
  const by = offsetY + block.bounds.y;

  for (let li = 0; li < block.children.length; li++) {
    const child = block.children[li];
    if (!child) continue;
    if (child.type === 'line-box') {
      collectLineBox(entries, child, bx, by, blockIndex, li);
    } else if (child.type === 'layout-block') {
      collectBlock(entries, child, bx, by, blockIndex);
    }
  }
}

function collectLineBox(
  entries: HitEntry[],
  lineBox: LineBox,
  offsetX: number,
  offsetY: number,
  blockIndex: number,
  lineIndex: number,
): void {
  const lx = offsetX + lineBox.bounds.x;
  const ly = offsetY + lineBox.bounds.y;

  for (let ri = 0; ri < lineBox.runs.length; ri++) {
    const run = lineBox.runs[ri];
    if (!run) continue;
    if (run.type === 'text-run') {
      entries.push(textRunEntry(run, lx, ly, blockIndex, lineIndex, ri));
    } else {
      const fallbackStyle = findLineStyle(lineBox);
      if (fallbackStyle)
        entries.push(atomEntry(run, lx, ly, blockIndex, lineIndex, ri, fallbackStyle));
    }
  }
}

function textRunEntry(
  run: TextRun,
  offsetX: number,
  offsetY: number,
  blockIndex: number,
  lineIndex: number,
  runIndex: number,
): HitEntry {
  const entry: HitEntry = {
    bounds: absoluteBounds(run.bounds, offsetX, offsetY),
    blockIndex,
    lineIndex,
    runIndex,
    text: run.text,
    style: run.style,
  };
  return run.href ? { ...entry, href: run.href } : entry;
}

function atomEntry(
  atom: InlineAtom,
  offsetX: number,
  offsetY: number,
  blockIndex: number,
  lineIndex: number,
  runIndex: number,
  defaultStyle: ComputedStyle,
): HitEntry {
  const entry: HitEntry = {
    bounds: absoluteBounds(atom.bounds, offsetX, offsetY),
    blockIndex,
    lineIndex,
    runIndex,
    text: '',
    style: defaultStyle,
  };
  return atom.href ? { ...entry, href: atom.href } : entry;
}

function findLineStyle(lineBox: LineBox): ComputedStyle | undefined {
  for (const run of lineBox.runs) {
    if (run.type === 'text-run') return run.style;
  }
  return undefined;
}

function absoluteBounds(
  bounds: { x: number; y: number; width: number; height: number },
  offsetX: number,
  offsetY: number,
) {
  return {
    x: offsetX + bounds.x,
    y: offsetY + bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}
