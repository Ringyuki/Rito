// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { parseCssRules } from '../../src/style/css/rule-parser';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { layoutBlocks } from '../../src/layout/block';
import type { LayoutBlock } from '../../src/layout/core/types';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const CONTENT_WIDTH = 400;
const BASE = 16;

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

function layoutTable(body: string, css?: string): LayoutBlock {
  const { nodes } = parseXhtml(xhtml(body));
  const rules = css ? parseCssRules(css, BASE) : undefined;
  const styled = resolveStyles(nodes, undefined, rules);
  const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
  const table = blocks[0];
  expect(table).toBeDefined();
  return table as LayoutBlock;
}

describe('table box model through block dispatch', () => {
  it('centers table with margin: 0 auto and explicit width', () => {
    const t = layoutTable(
      '<table style="margin: 0 auto; width: 200px;"><tr><td>A</td></tr></table>',
    );
    expect(t.bounds.x).toBeCloseTo(100, 0);
    expect(t.bounds.width).toBeLessThanOrEqual(200);
  });

  it('respects CSS width constraint on table', () => {
    const t = layoutTable('<table style="width: 200px;"><tr><td>A</td></tr></table>');
    expect(t.bounds.width).toBeLessThanOrEqual(200);
  });

  it('respects max-width on table', () => {
    const t = layoutTable('<table style="max-width: 250px;"><tr><td>A</td></tr></table>');
    expect(t.bounds.width).toBeLessThanOrEqual(250);
  });

  it('centers table with max-width and margin auto', () => {
    const t = layoutTable(
      '<table style="max-width: 200px; margin: 0 auto;"><tr><td>A</td></tr></table>',
    );
    expect(t.bounds.width).toBeLessThanOrEqual(200);
    expect(t.bounds.x).toBeGreaterThan(0);
    expect(t.bounds.x).toBeCloseTo((CONTENT_WIDTH - t.bounds.width) / 2, 0);
  });

  it('does not center when margin auto is not set', () => {
    const t = layoutTable('<table style="width: 200px;"><tr><td>A</td></tr></table>');
    expect(t.bounds.x).toBe(0);
  });

  it('handles margin-left auto only (right-align)', () => {
    const t = layoutTable(
      '<table style="width: 200px; margin-left: auto;"><tr><td>A</td></tr></table>',
    );
    expect(t.bounds.x).toBeCloseTo(200, 0);
  });

  it('does not over-center when min-content exceeds target width', () => {
    const longWord = 'A'.repeat(60);
    const t = layoutTable(
      `<table style="width: 100px; margin: 0 auto;"><tr><td>${longWord}</td></tr></table>`,
    );
    expect(t.bounds.x).toBeGreaterThanOrEqual(0);
  });
});
