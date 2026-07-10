import type {
  InlineAtom,
  LayoutBlock,
  LineBox,
  Page,
  Rect,
  TextRun,
} from '../../layout/core/types';
import type { TextMeasurer } from '../../layout/text/text-measurer';
import type { MeasurePaint } from '../../style/core/paint-types';
import { offsetBounds } from './bounds';
import { candidatesAtY, createHitIndex, type HitIndex } from './hit-index';
import { walkPageLineBoxes } from './text-traversal';
import type { HitEntry, HitMap, TextPosition } from './types';
import {
  containsPoint,
  createPageVisualGeometry,
  enterBlockVisualGeometry,
  inverseTransformPoint,
  resolveVisualRect,
  type VisualGeometry,
} from './visual-geometry';

interface EntryGeometry {
  readonly sourceBounds: Rect;
  readonly visual: VisualGeometry;
}

const ENTRY_GEOMETRY = new WeakMap<HitEntry, EntryGeometry>();
const HIT_INDEX = new WeakMap<HitMap, HitIndex>();

/**
 * Build a HitMap from a page's layout data.
 * Registers text runs, inline atoms, and block-level images. Entry bounds are
 * transformed, clipped, and expressed in page-content space (without margins).
 */
export function buildHitMap(page: Page): HitMap {
  const entries: HitEntry[] = [];
  walkPageLineBoxes(page, ({ blockIndex, lineIndex, lineBox, originX, originY, visual }) => {
    collectLineBox(entries, lineBox, originX, originY, blockIndex, lineIndex, visual);
  });

  const pageVisual = createPageVisualGeometry();
  for (let blockIndex = 0; blockIndex < page.content.length; blockIndex++) {
    const block = page.content[blockIndex];
    if (block) collectBlockImages(block, entries, blockIndex, 0, 0, pageVisual);
  }

  const hitMap: HitMap = { entries, pageIndex: page.index };
  HIT_INDEX.set(hitMap, createHitIndex(entries));
  return hitMap;
}

/**
 * Find the entry at a page-content point. Exact transformed geometry wins; if
 * the point lies between runs on the same visual row, the horizontally nearest
 * entry is returned to keep text-caret placement forgiving.
 */
export function hitTest(hitMap: HitMap, x: number, y: number): HitEntry | undefined {
  const index = HIT_INDEX.get(hitMap) ?? createAndStoreHitIndex(hitMap);
  const candidates = candidatesAtY(index, y);
  let best: HitEntry | undefined;
  let bestDist = Infinity;

  for (const entry of candidates) {
    if (entryContainsPoint(entry, x, y)) return entry;
    const dx = x < entry.bounds.x ? entry.bounds.x - x : x - entry.bounds.x - entry.bounds.width;
    if (dx < bestDist) {
      bestDist = dx;
      best = entry;
    }
  }
  return best;
}

/** Resolve a precise character position from page-content coordinates. */
export function resolveCharPosition(
  hitMap: HitMap,
  x: number,
  y: number,
  measurer: TextMeasurer,
): TextPosition | undefined {
  const entry = hitTest(hitMap, x, y);
  if (!entry || entry.text.length === 0 || !entry.measure) return undefined;

  const geometry = ENTRY_GEOMETRY.get(entry);
  const localPoint = geometry ? inverseTransformPoint(x, y, geometry.visual.matrix) : { x, y };
  if (!localPoint) return undefined;
  const sourceBounds = geometry?.sourceBounds ?? entry.bounds;
  const localX = localPoint.x - sourceBounds.x;
  const charIndex = findCharIndex(entry.text, sourceBounds.width, localX, measurer, entry.measure);
  return {
    blockIndex: entry.blockIndex,
    lineIndex: entry.lineIndex,
    runIndex: entry.runIndex,
    charIndex,
  };
}

/** Convert a horizontal slice of an entry's untransformed run box to visual geometry. */
export function resolveHitEntrySliceBounds(
  entry: HitEntry,
  startPx: number,
  endPx: number,
): Rect | undefined {
  const geometry = ENTRY_GEOMETRY.get(entry);
  if (!geometry) {
    return {
      x: entry.bounds.x + startPx,
      y: entry.bounds.y,
      width: Math.max(0, endPx - startPx),
      height: entry.bounds.height,
    };
  }
  const source = geometry.sourceBounds;
  return resolveVisualRect(
    {
      x: source.x + startPx,
      y: source.y,
      width: Math.max(0, endPx - startPx),
      height: source.height,
    },
    geometry.visual,
  );
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
    const width = measurer.measureText(text.slice(0, mid + 1), paint).width;
    if (width <= targetX) lo = mid + 1;
    else hi = mid;
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
  visual: VisualGeometry,
): void {
  for (let runIndex = 0; runIndex < lineBox.runs.length; runIndex++) {
    const run = lineBox.runs[runIndex];
    if (!run || run.type === 'ruby-annotation') continue;
    const entry =
      run.type === 'text-run'
        ? textRunEntry(run, lineOriginX, lineOriginY, blockIndex, lineIndex, runIndex, visual)
        : atomEntry(run, lineOriginX, lineOriginY, blockIndex, lineIndex, runIndex, visual);
    if (entry) entries.push(entry);
  }
}

function measurePaintFromRun(run: TextRun): MeasurePaint {
  return {
    font: run.paint.font,
    ...(run.paint.wordSpacingPx !== undefined ? { wordSpacingPx: run.paint.wordSpacingPx } : {}),
    ...(run.paint.letterSpacingPx !== undefined
      ? { letterSpacingPx: run.paint.letterSpacingPx }
      : {}),
  };
}

function textRunEntry(
  run: TextRun,
  offsetX: number,
  offsetY: number,
  blockIndex: number,
  lineIndex: number,
  runIndex: number,
  visual: VisualGeometry,
): HitEntry | undefined {
  const sourceBounds = offsetBounds(run.bounds, offsetX, offsetY);
  const bounds = resolveVisualRect(sourceBounds, visual);
  if (!bounds) return undefined;
  const base: HitEntry = {
    bounds,
    blockIndex,
    lineIndex,
    runIndex,
    text: run.text,
    measure: measurePaintFromRun(run),
    ...(run.href ? { href: run.href } : {}),
    ...(run.sourceRef ? { sourceRef: run.sourceRef } : {}),
    ...(run.sourceText !== undefined ? { sourceText: run.sourceText } : {}),
    ...(run.sourceTextOffset !== undefined ? { sourceTextOffset: run.sourceTextOffset } : {}),
  };
  ENTRY_GEOMETRY.set(base, { sourceBounds, visual });
  return base;
}

function atomEntry(
  atom: InlineAtom,
  offsetX: number,
  offsetY: number,
  blockIndex: number,
  lineIndex: number,
  runIndex: number,
  visual: VisualGeometry,
): HitEntry | undefined {
  const sourceBounds = offsetBounds(atom.bounds, offsetX, offsetY);
  const bounds = resolveVisualRect(sourceBounds, visual);
  if (!bounds) return undefined;
  const entry: HitEntry = {
    bounds,
    blockIndex,
    lineIndex,
    runIndex,
    text: '',
    ...(atom.imageSrc ? { imageSrc: atom.imageSrc } : {}),
    ...(atom.alt ? { imageAlt: atom.alt } : {}),
    ...(atom.href ? { href: atom.href } : {}),
  };
  ENTRY_GEOMETRY.set(entry, { sourceBounds, visual });
  return entry;
}

function collectBlockImages(
  block: LayoutBlock,
  entries: HitEntry[],
  blockIndex: number,
  offsetX: number,
  offsetY: number,
  parentVisual: VisualGeometry,
): void {
  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;
  const visual = enterBlockVisualGeometry(block, blockX, blockY, parentVisual);
  for (const child of block.children) {
    if (child.type === 'image') {
      const sourceBounds = offsetBounds(child.bounds, blockX, blockY);
      const bounds = resolveVisualRect(sourceBounds, visual);
      if (!bounds) continue;
      const entry: HitEntry = {
        bounds,
        blockIndex,
        lineIndex: 0,
        runIndex: 0,
        text: '',
        imageSrc: child.src,
        ...(child.alt ? { imageAlt: child.alt } : {}),
        ...(child.href ? { href: child.href } : {}),
      };
      ENTRY_GEOMETRY.set(entry, { sourceBounds, visual });
      entries.push(entry);
    } else if (child.type === 'layout-block') {
      collectBlockImages(child, entries, blockIndex, blockX, blockY, visual);
    }
  }
}

function entryContainsPoint(entry: HitEntry, x: number, y: number): boolean {
  if (!containsPoint(entry.bounds, x, y)) return false;
  const geometry = ENTRY_GEOMETRY.get(entry);
  if (!geometry) return true;
  if (geometry.visual.clip && !containsPoint(geometry.visual.clip, x, y)) return false;
  const point = inverseTransformPoint(x, y, geometry.visual.matrix);
  return point ? containsPoint(geometry.sourceBounds, point.x, point.y) : false;
}

function createAndStoreHitIndex(hitMap: HitMap): HitIndex {
  const index = createHitIndex(hitMap.entries);
  HIT_INDEX.set(hitMap, index);
  return index;
}
