import type { InlineAtom, LayoutBlock, LineBox, Page, TextRun } from '../../layout/core/types';
import type { MeasurePaint } from '../../style/core/paint-types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { HitEntry, HitMap, TextPosition } from './types';
import { offsetBounds } from './bounds';
import { walkPageLineBoxes } from './text-traversal';

/**
 * Build a HitMap from a page's layout data.
 * Registers text runs, inline atoms (with imageSrc), and block-level images.
 * All entry bounds are in **page-content** space (origin = top-left of content area, no margins).
 */
export function buildHitMap(page: Page): HitMap {
  const entries: HitEntry[] = [];
  walkPageLineBoxes(page, ({ blockIndex, lineIndex, lineBox, originX, originY }) => {
    collectLineBox(entries, lineBox, originX, originY, blockIndex, lineIndex);
  });
  // Also collect block-level images (not covered by line box traversal)
  collectBlockImages(page.content, entries);
  return { entries, pageIndex: page.index };
}

/** Find the HitEntry at the given page-content coordinates. */
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
 * Resolve a precise character position from page-content coordinates.
 * Uses the measurer to subdivide a matched TextRun for char-level accuracy.
 */
export function resolveCharPosition(
  hitMap: HitMap,
  x: number,
  y: number,
  measurer: TextMeasurer,
): TextPosition | undefined {
  const entry = hitTest(hitMap, x, y);
  if (!entry || entry.text.length === 0 || !entry.measure) return undefined;

  const localX = x - entry.bounds.x;
  const charIndex = findCharIndex(entry.text, entry.bounds.width, localX, measurer, entry.measure);
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
  paint: MeasurePaint,
): number {
  if (targetX <= 0) return 0;
  if (targetX >= totalWidth) return text.length;

  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const w = measurer.measureText(text.slice(0, mid + 1), paint).width;
    if (w <= targetX) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  return lo;
}

function collectLineBox(
  entries: HitEntry[],
  lineBox: LineBox,
  lineOriginX: number,
  lineOriginY: number,
  blockIndex: number,
  lineIndex: number,
): void {
  for (let ri = 0; ri < lineBox.runs.length; ri++) {
    const run = lineBox.runs[ri];
    if (!run) continue;
    if (run.type === 'text-run') {
      entries.push(textRunEntry(run, lineOriginX, lineOriginY, blockIndex, lineIndex, ri));
    } else if (run.type === 'inline-atom') {
      entries.push(atomEntry(run, lineOriginX, lineOriginY, blockIndex, lineIndex, ri));
    }
    // Ruby annotations are not hit targets — they don't produce selectable text.
  }
}

function measurePaintFromRun(run: TextRun): MeasurePaint {
  return run.paint.wordSpacingPx !== undefined
    ? { font: run.paint.font, wordSpacingPx: run.paint.wordSpacingPx }
    : { font: run.paint.font };
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
    bounds: offsetBounds(run.bounds, offsetX, offsetY),
    blockIndex,
    lineIndex,
    runIndex,
    text: run.text,
    measure: measurePaintFromRun(run),
    ...(run.sourceRef ? { sourceRef: run.sourceRef } : {}),
    ...(run.sourceText !== undefined ? { sourceText: run.sourceText } : {}),
    ...(run.sourceTextOffset !== undefined ? { sourceTextOffset: run.sourceTextOffset } : {}),
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
): HitEntry {
  // Inline atoms (images, inline-blocks) carry no text and need no measurer;
  // the hit map only treats them as positional targets.
  const entry: HitEntry = {
    bounds: offsetBounds(atom.bounds, offsetX, offsetY),
    blockIndex,
    lineIndex,
    runIndex,
    text: '',
    ...(atom.imageSrc ? { imageSrc: atom.imageSrc } : {}),
    ...(atom.alt ? { imageAlt: atom.alt } : {}),
  };
  return atom.href ? { ...entry, href: atom.href } : entry;
}

/** Walk layout blocks and register block-level ImageElement children as HitEntries. */
function collectBlockImages(
  blocks: readonly LayoutBlock['children'][number][],
  entries: HitEntry[],
  offsetX = 0,
  offsetY = 0,
  blockIndex = 0,
): void {
  for (const child of blocks) {
    if (child.type === 'image') {
      let imgEntry: HitEntry = {
        bounds: offsetBounds(child.bounds, offsetX, offsetY),
        blockIndex,
        lineIndex: 0,
        runIndex: 0,
        text: '',
        imageSrc: child.src,
      };
      if (child.alt) imgEntry = { ...imgEntry, imageAlt: child.alt };
      if (child.href) imgEntry = { ...imgEntry, href: child.href };
      entries.push(imgEntry);
    } else if (child.type === 'layout-block') {
      collectBlockImages(
        child.children,
        entries,
        offsetX + child.bounds.x,
        offsetY + child.bounds.y,
        blockIndex,
      );
    }
  }
}
