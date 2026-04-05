/**
 * Phase 0 — Characterization test: right-page link hit testing.
 *
 * This test reproduces the confirmed P0 bug: links on the right page of a
 * double-page spread cannot be hit because rebuildLinkRegions() flattens
 * left and right page regions without offsetting the right page.
 */
import { describe, expect, it } from 'vitest';
import { buildLinkMap, hitTestLink } from 'rito/advanced';
import type { LayoutBlock, LineBox, TextRun } from 'rito/advanced';
import type { Page } from 'rito';
import { DEFAULT_STYLE } from 'rito/advanced';

const style = { ...DEFAULT_STYLE, fontSize: 10 };

function makeLink(text: string, x: number, href: string): TextRun {
  return {
    type: 'text-run',
    text,
    bounds: { x, y: 0, width: text.length * 10, height: 20 },
    style,
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

describe('Right-page link hit testing (P0 bug)', () => {
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

  describe('right page link in flattened region list (current broken behavior)', () => {
    // This simulates what rebuildLinkRegions currently does:
    // flat-concat left and right page regions without offsetting
    it('FAILS: right page link cannot be hit at spread-content coordinates', () => {
      const leftRegions = buildLinkMap(leftPage);
      const rightRegions = buildLinkMap(rightPage);
      const flatRegions = [...leftRegions, ...rightRegions];

      // User clicks right page at spread-content x = CONTENT_WIDTH + CONTENT_GAP + 55
      const spreadX = CONTENT_WIDTH + CONTENT_GAP + 55;
      const hit = hitTestLink(flatRegions, spreadX, 15);

      // BUG: This returns undefined because the right page region
      // has bounds.x = 50, not 450
      expect(hit).toBeUndefined(); // Confirms the bug exists
    });
  });

  describe('right page link with correct per-page offset (expected fix)', () => {
    it('should hit right page link when regions are properly offset', () => {
      const leftRegions = buildLinkMap(leftPage);
      const rightRegions = buildLinkMap(rightPage);

      // After fix: right page regions should be offset by rightPageContentOffset
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
