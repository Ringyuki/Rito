import type { LayoutBlock, LineBox, Page, Rect } from '../../layout/core/types';
import type { LinkRegion } from './types';

/**
 * Build a list of hyperlink regions from a page's layout data.
 * All region bounds are in **page-content** space (origin = top-left of content area, no margins).
 */
export function buildLinkMap(page: Page): readonly LinkRegion[] {
  const regions: LinkRegion[] = [];
  for (const block of page.content) {
    collectBlockLinks(regions, block, 0, 0);
  }
  return mergeAdjacentLinks(regions);
}

/** Hit-test a point (in page-content space) against link regions. Returns the matched region or undefined. */
export function hitTestLink(
  regions: readonly LinkRegion[],
  x: number,
  y: number,
): LinkRegion | undefined {
  for (const region of regions) {
    const b = region.bounds;
    if (x >= b.x && x <= b.x + b.width && y >= b.y && y <= b.y + b.height) {
      return region;
    }
  }
  return undefined;
}

function collectBlockLinks(
  out: LinkRegion[],
  block: LayoutBlock,
  offsetX: number,
  offsetY: number,
): void {
  const bx = offsetX + block.bounds.x;
  const by = offsetY + block.bounds.y;

  for (const child of block.children) {
    if (child.type === 'line-box') {
      collectLineLinks(out, child, bx, by);
    } else if (child.type === 'layout-block') {
      collectBlockLinks(out, child, bx, by);
    } else if (child.type === 'image' && child.href) {
      out.push({
        bounds: {
          x: bx + child.bounds.x,
          y: by + child.bounds.y,
          width: child.bounds.width,
          height: child.bounds.height,
        },
        href: child.href,
        text: child.alt ?? '',
      });
    }
  }
}

function collectLineLinks(
  out: LinkRegion[],
  lineBox: LineBox,
  offsetX: number,
  offsetY: number,
): void {
  const lx = offsetX + lineBox.bounds.x;
  const ly = offsetY + lineBox.bounds.y;

  for (const run of lineBox.runs) {
    const href = run.href;
    if (!href) continue;

    out.push({
      bounds: {
        x: lx + run.bounds.x,
        y: ly + run.bounds.y,
        width: run.bounds.width,
        height: run.bounds.height,
      },
      href,
      text: run.type === 'text-run' ? run.text : '',
    });
  }
}

/**
 * Merge adjacent link regions with the same href on the same line (same y position).
 * This collapses multiple TextRuns from a single <a> into one clickable region.
 */
function mergeAdjacentLinks(regions: readonly LinkRegion[]): LinkRegion[] {
  if (regions.length === 0) return [];
  const merged: LinkRegion[] = [];
  let current = regions[0];
  if (!current) return [];

  for (let i = 1; i < regions.length; i++) {
    const next = regions[i];
    if (!next) continue;
    if (canMerge(current, next)) {
      current = mergeRegions(current, next);
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

function canMerge(a: LinkRegion, b: LinkRegion): boolean {
  return a.href === b.href && a.bounds.y === b.bounds.y;
}

function mergeRegions(a: LinkRegion, b: LinkRegion): LinkRegion {
  const x = Math.min(a.bounds.x, b.bounds.x);
  const right = Math.max(a.bounds.x + a.bounds.width, b.bounds.x + b.bounds.width);
  const bounds: Rect = { x, y: a.bounds.y, width: right - x, height: a.bounds.height };
  return { bounds, href: a.href, text: a.text + b.text };
}
