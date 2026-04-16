/**
 * Regression-note test: right-page link hit-testing geometry.
 *
 * `buildLinkMap()` is page-local by design. Older controller code used to
 * flatten left/right page regions into one spread-space list without
 * offsetting the right page, which made right-page links unclickable in
 * double-page mode. The current controller keeps regions per-page and maps
 * spread coordinates back into page space before hit-testing.
 */
import { describe, expect, it } from 'vitest';
import { buildLinkMap, hitTestLink } from '@ritojs/core/advanced';
import type { LayoutBlock, LineBox, TextRun } from '@ritojs/core/advanced';
import type { Page } from '@ritojs/core';
import { DEFAULT_RUN_PAINT } from '@ritojs/core/advanced';

function makeLink(text: string, x: number, href: string): TextRun {
  return {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width: text.length * 10, height: 20 },
    paint: DEFAULT_RUN_PAINT,
    href,
  };
}

function makeLine(runs: TextRun[], y: number): LineBox {
  return { type: 'line-box', bounds: { x: 0, y, width: 300, height: 20 }, runs };
}

function makeBlock(lines: LineBox[]): LayoutBlock {
  return {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: 300, height: 100 },
    children: lines,
  };
}

function makePage(blocks: LayoutBlock[], index: number): Page {
  return { index, bounds: { x: 0, y: 0, width: 300, height: 400 }, content: blocks };
}

describe('Right-page link hit-testing geometry', () => {
  // Simulates the spread geometry:
  // contentWidth = 300, contentGap = 100, so right page content starts at x = 400
  const CONTENT_WIDTH = 300;
  const CONTENT_GAP = 100; // marginLeft + spreadGap + marginRight

  const leftPage = makePage(
    [makeBlock([makeLine([makeLink('LeftLink', 50, 'http://left.com')], 10)])],
    0,
  );
  const rightPage = makePage(
    [makeBlock([makeLine([makeLink('RightLink', 50, 'http://right.com')], 10)])],
    1,
  );

  it('buildLinkMap produces page-content coords (no spread offset)', () => {
    const leftRegions = buildLinkMap(leftPage);
    const rightRegions = buildLinkMap(rightPage);

    // Both should have regions at similar x coordinates (page-local)
    expect(leftRegions.length).toBe(1);
    expect(rightRegions.length).toBe(1);
    expect(leftRegions[0]?.bounds.x).toBe(50);
    expect(rightRegions[0]?.bounds.x).toBe(50);
  });

  it('left page link can be hit at page-content coordinates', () => {
    const regions = buildLinkMap(leftPage);
    const hit = hitTestLink(regions, 55, 15);
    expect(hit).toBeDefined();
    expect(hit?.href).toBe('http://left.com');
  });

  describe('historical flattened-region bug model', () => {
    // This simulates the pre-fix controller approach:
    // flat-concat left and right page regions without offsetting.
    it('shows why naive spread-space hit-testing missed the right page', () => {
      const leftRegions = buildLinkMap(leftPage);
      const rightRegions = buildLinkMap(rightPage);
      const flatRegions = [...leftRegions, ...rightRegions];

      // User clicks right page at spread-content x = CONTENT_WIDTH + CONTENT_GAP + 55
      const spreadX = CONTENT_WIDTH + CONTENT_GAP + 55;
      const hit = hitTestLink(flatRegions, spreadX, 15);

      // The right-page region still has page-local x = 50 instead of spread
      // x = 450, so a spread-space hit test misses it.
      expect(hit).toBeUndefined();
    });
  });

  describe('correctly offset spread-space model', () => {
    it('hits the right-page link when the page offset is applied', () => {
      const leftRegions = buildLinkMap(leftPage);
      const rightRegions = buildLinkMap(rightPage);

      // Equivalent to converting spread-space coordinates back into the
      // right page's local coordinate system before hit-testing.
      const rightPageOffset = CONTENT_WIDTH + CONTENT_GAP;
      const offsetRightRegions = rightRegions.map((r) => ({
        ...r,
        bounds: { ...r.bounds, x: r.bounds.x + rightPageOffset },
      }));

      const allRegions = [...leftRegions, ...offsetRightRegions];
      const spreadX = rightPageOffset + 55;
      const hit = hitTestLink(allRegions, spreadX, 15);

      expect(hit).toBeDefined();
      expect(hit?.href).toBe('http://right.com');
    });
  });
});
