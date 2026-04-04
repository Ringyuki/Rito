// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseCssDeclarations } from '../../src/style/css/property-parser';
import { parseCssRules } from '../../src/style/css/rule-parser';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { layoutBlocks } from '../../src/layout/block';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const CONTENT_WIDTH = 360;
const BASE = 16;

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

describe('margin shorthand parsing', () => {
  it('parses margin: 0', () => {
    const result = parseCssDeclarations('margin: 0', BASE);
    expect(result.marginTop).toBe(0);
    expect(result.marginBottom).toBe(0);
  });

  it('parses margin: 4em 0 0 0 (top right bottom left)', () => {
    const result = parseCssDeclarations('margin: 4em 0 0 0', BASE);
    expect(result.marginTop).toBe(64); // 4 * 16
    expect(result.marginBottom).toBe(0);
  });

  it('parses margin: 0.15em 0 0 0', () => {
    const result = parseCssDeclarations('margin: 0.15em 0 0 0', BASE);
    expect(result.marginTop).toBeCloseTo(2.4); // 0.15 * 16
    expect(result.marginBottom).toBe(0);
  });

  it('parses margin: 0.3em 0 0 0', () => {
    const result = parseCssDeclarations('margin: 0.3em 0 0 0', BASE);
    expect(result.marginTop).toBeCloseTo(4.8);
    expect(result.marginBottom).toBe(0);
  });

  it('parses margin: 3.5em 0 0.15em 0', () => {
    const result = parseCssDeclarations('margin: 3.5em 0 0.15em 0', BASE);
    expect(result.marginTop).toBeCloseTo(56); // 3.5 * 16
    expect(result.marginBottom).toBeCloseTo(2.4); // 0.15 * 16
  });

  it('parses margin: 2em 0 0.15em 0', () => {
    const result = parseCssDeclarations('margin: 2em 0 0.15em 0', BASE);
    expect(result.marginTop).toBeCloseTo(32);
    expect(result.marginBottom).toBeCloseTo(2.4);
  });

  it('2-value shorthand: margin: 1em 2em', () => {
    const result = parseCssDeclarations('margin: 1em 2em', BASE);
    expect(result.marginTop).toBe(16);
    expect(result.marginBottom).toBe(16);
  });

  it('3-value shorthand: margin: 1em 2em 3em', () => {
    const result = parseCssDeclarations('margin: 1em 2em 3em', BASE);
    expect(result.marginTop).toBe(16);
    expect(result.marginBottom).toBe(48);
  });

  it('margin shorthand overrides individual properties', () => {
    const result = parseCssDeclarations('margin-top: 10px; margin: 0', BASE);
    // margin shorthand comes after, should win
    expect(result.marginTop).toBe(0);
  });
});

describe('line-height percentage', () => {
  it('parses line-height: 130%', () => {
    const result = parseCssDeclarations('line-height: 130%', BASE);
    expect(result.lineHeight).toBeCloseTo(1.3);
  });

  it('parses line-height: 120%', () => {
    const result = parseCssDeclarations('line-height: 120%', BASE);
    expect(result.lineHeight).toBeCloseTo(1.2);
  });

  it('parses line-height: 100%', () => {
    const result = parseCssDeclarations('line-height: 100%', BASE);
    expect(result.lineHeight).toBeCloseTo(1.0);
  });
});

describe('percentage length in margins', () => {
  it('parses margin-top: 0%', () => {
    const result = parseCssDeclarations('margin-top: 0%', BASE);
    expect(result.marginTop).toBe(0);
  });
});

describe('global stylesheet rules affect real nodes', () => {
  const REAL_CSS = `
    body { line-height: 130%; text-align: justify; }
    h4 { font-size: 1.4em; text-align: center; text-indent: 0em; font-weight: bold; margin-top: 1em; margin-bottom: 1.5em; }
    p { text-indent: 2em; line-height: 1.3em; margin-top: 0.4em; margin-bottom: 0.4em; }
  `;

  it('p rule applies text-indent, margins, and line-height', () => {
    const rules = parseCssRules(REAL_CSS, BASE);
    // Compute body base style (as paginate() does)
    const bodyStyle = { ...DEFAULT_STYLE };
    for (const rule of rules) {
      if (rule.selector === 'body') Object.assign(bodyStyle, rule.declarations);
    }
    const { nodes } = parseXhtml(xhtml('<p>Hello world</p>'));
    const styled = resolveStyles(nodes, bodyStyle, rules);

    const p = styled[0];
    expect(p?.style.textIndent).toBe(32); // 2em * 16
    expect(p?.style.marginTop).toBeCloseTo(6.4); // 0.4em * 16
    expect(p?.style.marginBottom).toBeCloseTo(6.4);
    expect(p?.style.lineHeight).toBeCloseTo(1.3);
    expect(p?.style.textAlign).toBe('justify'); // inherited from body
  });

  it('h4 rule applies font-size, text-align, margins', () => {
    const rules = parseCssRules(REAL_CSS, BASE);
    const { nodes } = parseXhtml(xhtml('<h4>Title</h4>'));
    const styled = resolveStyles(nodes, undefined, rules);

    const h4 = styled[0];
    expect(h4?.style.fontSize).toBeCloseTo(22.4); // 1.4em * 16
    expect(h4?.style.textAlign).toBe('center');
    expect(h4?.style.fontWeight).toBe(700);
    expect(h4?.style.marginTop).toBeCloseTo(22.4); // 1em * 22.4 (own font-size)
    expect(h4?.style.marginBottom).toBeCloseTo(33.6); // 1.5em * 22.4
    expect(h4?.style.textIndent).toBe(0);
  });
});

describe('inline margin shorthand on real elements', () => {
  it('inline style margin: 0 overrides stylesheet margins', () => {
    const rules = parseCssRules('p { margin-top: 0.4em; margin-bottom: 0.4em; }', BASE);
    const { nodes } = parseXhtml(xhtml('<p style="margin: 0;">Content</p>'));
    const styled = resolveStyles(nodes, undefined, rules);

    const p = styled[0];
    expect(p?.style.marginTop).toBe(0);
    expect(p?.style.marginBottom).toBe(0);
  });

  it('inline margin: 4em 0 0 0 on wrapper div', () => {
    const { nodes } = parseXhtml(xhtml('<div style="margin: 4em 0 0 0;"><p>Content</p></div>'));
    const styled = resolveStyles(nodes);

    const div = styled[0];
    expect(div?.style.marginTop).toBe(64);
    expect(div?.style.marginBottom).toBe(0);
  });
});

describe('block spacing with resolved margins', () => {
  it('paragraphs with CSS margins produce correct block spacing', () => {
    const rules = parseCssRules('p { margin-top: 0.4em; margin-bottom: 0.4em; }', BASE);
    const { nodes } = parseXhtml(xhtml('<p>First</p><p>Second</p><p>Third</p>'));
    const styled = resolveStyles(nodes, undefined, rules);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(3);
    // Second block y should be: first block height + collapsed margin
    const firstBottom = (blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0);
    const secondTop = blocks[1]?.bounds.y ?? 0;
    const gap = secondTop - firstBottom;
    // Collapsed margin = max(0.4em, 0.4em) = 6.4px
    expect(gap).toBeCloseTo(6.4);
  });

  it('wrapper div margin propagates in block spacing', () => {
    const { nodes } = parseXhtml(
      xhtml('<div style="margin: 4em 0 0 0;"><p style="margin: 0;">Content</p></div>'),
    );
    const styled = resolveStyles(nodes);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    // Div marginTop=64, p marginTop=0 (inline overrides tag default)
    // Collapsed: max(0, 0) = 0, so p starts at 64
    expect(blocks[0]?.bounds.y).toBeCloseTo(64);
  });

  it('title page structure: wrapper margin + zero-margin paragraphs', () => {
    const { nodes } = parseXhtml(
      xhtml(`
        <div style="margin: 4em 0 0 0;">
          <p style="margin: 0;">Line 1</p>
          <p style="margin: 0;">Line 2</p>
          <p style="margin: 0.15em 0 0 0;">Line 3</p>
        </div>
      `),
    );
    const styled = resolveStyles(nodes);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    // First block starts at wrapper marginTop = 64
    expect(blocks[0]?.bounds.y).toBeCloseTo(64);
    // Second block: zero margins, so immediately after first
    const firstBottom = (blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0);
    const secondTop = blocks[1]?.bounds.y ?? 0;
    expect(secondTop).toBeCloseTo(firstBottom);
    // Third block: marginTop = 0.15em = 2.4px
    const secondBottom = (blocks[1]?.bounds.y ?? 0) + (blocks[1]?.bounds.height ?? 0);
    const thirdTop = blocks[2]?.bounds.y ?? 0;
    expect(thirdTop - secondBottom).toBeCloseTo(2.4);
  });
});
