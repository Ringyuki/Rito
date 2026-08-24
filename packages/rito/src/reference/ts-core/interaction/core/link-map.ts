import type { LayoutBlock, LineBox, Page, Rect } from '../../layout/core/types';
import { offsetBounds } from './bounds';
import { walkPageLineBoxes } from './text-traversal';
import type { LinkRegion } from './types';
import {
  containsPoint,
  createPageVisualGeometry,
  enterBlockVisualGeometry,
  inverseTransformPoint,
  resolveVisualRect,
  type VisualGeometry,
} from './visual-geometry';

interface LinkPartGeometry {
  readonly sourceBounds: Rect;
  readonly visual: VisualGeometry;
}

const LINK_GEOMETRY = new WeakMap<LinkRegion, readonly LinkPartGeometry[]>();
const ADJACENCY_EPSILON = 0.5;

/** Build transformed and clipped hyperlink regions in page-content space. */
export function buildLinkMap(page: Page): readonly LinkRegion[] {
  const regions: LinkRegion[] = [];
  walkPageLineBoxes(page, ({ lineBox, originX, originY, visual }) => {
    collectLineLinks(regions, lineBox, originX, originY, visual);
  });

  const pageVisual = createPageVisualGeometry();
  for (const block of page.content) collectBlockImageLinks(regions, block, 0, 0, pageVisual);
  return mergeAdjacentLinks(regions);
}

/** Hit-test a page-content point against the regions' actual transformed boxes. */
export function hitTestLink(
  regions: readonly LinkRegion[],
  x: number,
  y: number,
): LinkRegion | undefined {
  for (const region of regions) {
    if (!containsPoint(region.bounds, x, y)) continue;
    const parts = LINK_GEOMETRY.get(region);
    if (!parts || parts.some((part) => partContainsPoint(part, x, y))) return region;
  }
  return undefined;
}

function collectLineLinks(
  out: LinkRegion[],
  lineBox: LineBox,
  lineOriginX: number,
  lineOriginY: number,
  visual: VisualGeometry,
): void {
  for (const run of lineBox.runs) {
    if (run.type === 'ruby-annotation' || !run.href) continue;
    const sourceBounds = offsetBounds(run.bounds, lineOriginX, lineOriginY);
    addRegion(out, sourceBounds, visual, run.href, run.type === 'text-run' ? run.text : '');
  }
}

function collectBlockImageLinks(
  out: LinkRegion[],
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
  parentVisual: VisualGeometry,
): void {
  const blockX = offsetX + block.bounds.x;
  const blockY = offsetY + block.bounds.y;
  const visual = enterBlockVisualGeometry(block, blockX, blockY, parentVisual);
  for (const child of block.children) {
    if (child.type === 'image' && child.href) {
      addRegion(
        out,
        offsetBounds(child.bounds, blockX, blockY),
        visual,
        child.href,
        child.alt ?? '',
      );
    } else if (child.type === 'layout-block') {
      collectBlockImageLinks(out, child, blockX, blockY, visual);
    }
  }
}

function addRegion(
  out: LinkRegion[],
  sourceBounds: Rect,
  visual: VisualGeometry,
  href: string,
  text: string,
): void {
  const bounds = resolveVisualRect(sourceBounds, visual);
  if (!bounds) return;
  const region: LinkRegion = { bounds, href, text };
  LINK_GEOMETRY.set(region, [{ sourceBounds, visual }]);
  out.push(region);
}

/** Merge only directly touching fragments from the same link on one visual line. */
function mergeAdjacentLinks(regions: readonly LinkRegion[]): LinkRegion[] {
  if (regions.length === 0) return [];
  const merged: LinkRegion[] = [];
  let current = regions[0];
  if (!current) return [];

  for (let index = 1; index < regions.length; index++) {
    const next = regions[index];
    if (!next) continue;
    if (canMerge(current, next)) current = mergeRegions(current, next);
    else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

function canMerge(a: LinkRegion, b: LinkRegion): boolean {
  if (a.href !== b.href) return false;
  const verticalMatch =
    Math.abs(a.bounds.y - b.bounds.y) <= ADJACENCY_EPSILON &&
    Math.abs(a.bounds.height - b.bounds.height) <= ADJACENCY_EPSILON;
  const gap = b.bounds.x - (a.bounds.x + a.bounds.width);
  return verticalMatch && Math.abs(gap) <= ADJACENCY_EPSILON;
}

function mergeRegions(a: LinkRegion, b: LinkRegion): LinkRegion {
  const left = Math.min(a.bounds.x, b.bounds.x);
  const top = Math.min(a.bounds.y, b.bounds.y);
  const right = Math.max(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width);
  const bottom = Math.max(a.bounds.y + a.bounds.height, b.bounds.y + b.bounds.height);
  const merged: LinkRegion = {
    bounds: { x: left, y: top, width: right - left, height: bottom - top },
    href: a.href,
    text: a.text + b.text,
  };
  LINK_GEOMETRY.set(merged, [...(LINK_GEOMETRY.get(a) ?? []), ...(LINK_GEOMETRY.get(b) ?? [])]);
  return merged;
}

function partContainsPoint(part: LinkPartGeometry, x: number, y: number): boolean {
  if (part.visual.clip && !containsPoint(part.visual.clip, x, y)) return false;
  const point = inverseTransformPoint(x, y, part.visual.matrix);
  return point ? containsPoint(part.sourceBounds, point.x, point.y) : false;
}
