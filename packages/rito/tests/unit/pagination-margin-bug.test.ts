// @vitest-environment happy-dom
/**
 * Test that block margins are preserved through pagination.
 */
import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { parseCssRules } from '../../src/style/css-rule-parser';
import { resolveStyles } from '../../src/style/resolver';
import { layoutBlocks } from '../../src/layout/block';
import { paginateBlocks } from '../../src/layout/pagination';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { createLayoutConfig } from '../../src/layout/core/config';
import { DEFAULT_STYLE } from '../../src/style/defaults';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);

// Tight page: 200px content height
const config = createLayoutConfig({ width: 400, height: 240, margin: 20 });
const CONTENT_WIDTH = config.pageWidth - config.marginLeft - config.marginRight;

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

describe('pagination preserves block margins', () => {
  it('blocks on a page have spacing between them', () => {
    // CSS: p has margin-top/bottom = 0.4em = 6.4px
    const css = 'p { margin-top: 0.4em; margin-bottom: 0.4em; }';
    const rules = parseCssRules(css, DEFAULT_STYLE.fontSize);
    const bodyStyle = { ...DEFAULT_STYLE };
    for (const r of rules) {
      if (r.selector === 'body') Object.assign(bodyStyle, r.declarations);
    }

    const { nodes } = parseXhtml(xhtml('<p>Line A</p><p>Line B</p><p>Line C</p>'));
    const styled = resolveStyles(nodes, bodyStyle, rules);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    // Before pagination: blocks should have margins between them
    expect(blocks.length).toBe(3);
    const gap01 =
      (blocks[1]?.bounds.y ?? 0) - ((blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0));
    expect(gap01).toBeGreaterThan(0); // margins exist

    const pages = paginateBlocks(blocks, config);

    // After pagination: blocks on the same page should STILL have spacing
    const page0 = pages[0];
    expect(page0).toBeDefined();
    if (!page0 || page0.content.length < 2) return;

    const b0 = page0.content[0];
    const b1 = page0.content[1];
    if (!b0 || !b1) return;

    const pageGap = b1.bounds.y - (b0.bounds.y + b0.bounds.height);
    expect(pageGap).toBeGreaterThan(0); // margin should be preserved
  });
});
