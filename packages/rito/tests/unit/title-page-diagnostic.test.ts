// @vitest-environment happy-dom
/**
 * Diagnostic test: traces actual values through the entire pipeline
 * for the real title-page structure from the demo EPUB.
 */
import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { parseCssRules } from '../../src/style/css/rule-parser';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { layoutBlocks } from '../../src/layout/block';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';
import type { StyledNode } from '../../src/style/core/types';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const CONTENT_WIDTH = 360;
const BASE = DEFAULT_STYLE.fontSize; // 16

// Real stylesheet rules from demo EPUB (subset)
const REAL_CSS = `
body {
  line-height: 130%;
  text-align: justify;
}
p {
  text-indent: 2em;
  line-height: 1.3em;
  margin-top: 0.4em;
  margin-bottom: 0.4em;
}
.center { text-align: center; }
.tilh { text-indent: 0em; }
.em04 { font-size: 0.4em; }
.em08 { font-size: 0.8em; }
.em09 { font-size: 0.9em; }
.em12 { font-size: 1.2em; }
.em13 { font-size: 1.3em; }
.em17 { font-size: 1.7em; }
.em26 { font-size: 2.6em; }
.tco1 { color: #716F71; }
`;

const TITLE_XHTML = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>Title</title></head>
<body>
<div class="title center" style="margin: 4em 0 0 0;">
  <p class="tilh em17" style="margin: 0;">关于我在无意间被</p>
  <p class="tilh em09" style="margin: 0;">She is the neighbor Angel</p>
  <p class="tilh em17" style="margin: 0.15em 0 0 0;"><span class="tco1">隔壁的天使</span>变成废柴这件事</p>
  <p class="tilh em26 tco1" style="margin: 0.3em 0 0 0;"><span class="em04">vol</span><span class="em12">1</span></p>
  <p class="tilh em08 tco1" style="margin: 3.5em 0 0.15em 0;">作者</p>
  <p class="tilh em13" style="margin: 0;">佐伯さん</p>
  <p class="tilh em08 tco1" style="margin: 2em 0 0.15em 0;">插画</p>
  <p class="tilh" style="margin: 0;">和武はざの</p>
</div>
</body>
</html>`;

function computeBodyStyle(css: string): typeof DEFAULT_STYLE {
  const rules = parseCssRules(css, BASE);
  const style = { ...DEFAULT_STYLE };
  for (const rule of rules) {
    if (rule.selector === 'body') {
      Object.assign(style, rule.declarations);
    }
  }
  return style;
}

// Find the div among body children (skip whitespace text nodes)
function findDiv(items: readonly { type: string; tag?: string }[]): number {
  return items.findIndex((n) => n.type === 'block' && n.tag === 'div');
}

describe('title page diagnostic', () => {
  const rules = parseCssRules(REAL_CSS, BASE);
  const bodyStyle = computeBodyStyle(REAL_CSS);
  const { nodes } = parseXhtml(TITLE_XHTML);
  const styled = resolveStyles(nodes, bodyStyle, rules);

  it('parser produces div.title.center with p children', () => {
    // parseXhtml returns children of <body> — may include whitespace text nodes
    const divIdx = findDiv(nodes);
    expect(divIdx).toBeGreaterThanOrEqual(0);
    const divNode = nodes[divIdx];
    expect(divNode?.type).toBe('block');
    if (divNode?.type === 'block') {
      expect(divNode.tag).toBe('div');
      expect(divNode.attributes?.class).toBe('title center');
      expect(divNode.attributes?.style).toBe('margin: 4em 0 0 0;');
      const blockChildren = divNode.children.filter((c) => c.type === 'block');
      expect(blockChildren).toHaveLength(8);
    }
  });

  it('resolved wrapper div.title.center', () => {
    const divIdx = findDiv(styled);
    const div = styled[divIdx];
    expect(div).toBeDefined();
    if (!div) return;
    expect(div.type).toBe('block');
    expect(div.tag).toBe('div');
    expect(div.style.textAlign).toBe('center');
    expect(div.style.marginTop).toBe(64);
    expect(div.style.marginBottom).toBe(0);
    expect(div.style.lineHeight).toBeCloseTo(1.3);
    expect(div.style.fontSize).toBe(BASE);
  });

  // Helper to get the div's block children from the styled tree
  function getStyledParagraphs(): StyledNode[] {
    const divIdx = findDiv(styled);
    const div = styled[divIdx];
    if (!div) return [];
    return div.children.filter((c): c is StyledNode => c.type === 'block');
  }

  it('resolved first p (em17, margin: 0)', () => {
    const firstP = getStyledParagraphs()[0];
    expect(firstP).toBeDefined();
    if (!firstP) return;
    // .em17: fontSize = 1.7 * 16 = 27.2
    expect(firstP.style.fontSize).toBeCloseTo(27.2);
    // .tilh: textIndent = 0
    expect(firstP.style.textIndent).toBe(0);
    // inline margin: 0 overrides everything
    expect(firstP.style.marginTop).toBe(0);
    expect(firstP.style.marginBottom).toBe(0);
    // inherits center from parent div
    expect(firstP.style.textAlign).toBe('center');
    // line-height: 1.3em from p rule → resolved against own fontSize=27.2
    // Actually: p rule has line-height: 1.3em, re-parsed with fontSize=27.2 → 1.3
    expect(firstP.style.lineHeight).toBeCloseTo(1.3);
  });

  it('resolved second p (em09, subtitle)', () => {
    const secondP = getStyledParagraphs()[1];
    expect(secondP).toBeDefined();
    if (!secondP) return;
    expect(secondP.style.fontSize).toBeCloseTo(14.4);
    expect(secondP.style.marginTop).toBe(0);
    expect(secondP.style.marginBottom).toBe(0);
    expect(secondP.style.textAlign).toBe('center');
  });

  it('resolved third p (em17, margin: 0.15em)', () => {
    const thirdP = getStyledParagraphs()[2];
    expect(thirdP).toBeDefined();
    if (!thirdP) return;
    expect(thirdP.style.fontSize).toBeCloseTo(27.2);
    // margin: 0.15em inline → resolved against element's own fontSize=27.2 (CSS spec)
    expect(thirdP.style.marginTop).toBeCloseTo(27.2 * 0.15);
    expect(thirdP.style.marginBottom).toBe(0);
  });

  it('resolved vol line (em26 tco1, margin: 0.3em)', () => {
    const volP = getStyledParagraphs()[3];
    expect(volP).toBeDefined();
    if (!volP) return;
    expect(volP.style.fontSize).toBeCloseTo(41.6);
    // margin: 0.3em inline → resolved against element's own fontSize=41.6
    expect(volP.style.marginTop).toBeCloseTo(41.6 * 0.3);
    expect(volP.style.marginBottom).toBe(0);
    expect(volP.style.color).toBe('#716F71');
  });

  it('resolved author label (em08 tco1, margin: 3.5em)', () => {
    const authorLabel = getStyledParagraphs()[4];
    expect(authorLabel).toBeDefined();
    if (!authorLabel) return;
    expect(authorLabel.style.fontSize).toBeCloseTo(12.8);
    // margin: 3.5em inline → resolved against element's own fontSize=12.8
    expect(authorLabel.style.marginTop).toBeCloseTo(12.8 * 3.5);
    expect(authorLabel.style.marginBottom).toBeCloseTo(12.8 * 0.15);
  });

  it('resolved author name (em13, margin: 0)', () => {
    const authorName = getStyledParagraphs()[5];
    expect(authorName).toBeDefined();
    if (!authorName) return;
    expect(authorName.style.fontSize).toBeCloseTo(20.8);
    expect(authorName.style.marginTop).toBe(0);
    expect(authorName.style.marginBottom).toBe(0);
  });

  describe('layout blocks', () => {
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    it('container is flattened into individual paragraph blocks', () => {
      // div should be flattened: 8 p elements become 8 individual blocks
      const blockCount = blocks.length;
      expect(blockCount).toBe(8);
      // All should have line-box children (text blocks, not containers)
      for (const b of blocks) {
        if (b.children.length > 0) {
          expect(b.children[0]?.type).toBe('line-box');
        }
      }
    });

    it('first block starts at wrapper marginTop = 64', () => {
      // Collapsed margin: max(0, div.marginTop=64) = 64
      // But first p has marginTop=0, so collapsed = max(64, 0) = 64
      // Wait: container is flattened. The div's marginTop is applied before its children.
      // So first p starts at y = 64 (div margin) + collapsed(0, p.margin=0) = 64
      expect(blocks[0]?.bounds.y).toBeCloseTo(64);
    });

    it('second block follows immediately after first (both margin: 0)', () => {
      const first = blocks[0];
      const second = blocks[1];
      if (!first || !second) return;
      // Both have marginBottom=0, marginTop=0 → gap = max(0, 0) = 0
      expect(second.bounds.y).toBeCloseTo(first.bounds.y + first.bounds.height);
    });

    it('third block has small gap from marginTop 0.15em', () => {
      const second = blocks[1];
      const third = blocks[2];
      if (!second || !third) return;
      const gap = third.bounds.y - (second.bounds.y + second.bounds.height);
      // marginTop = 0.15em * own fontSize(27.2) = 4.08, collapsed with prev marginBottom=0
      expect(gap).toBeCloseTo(27.2 * 0.15);
    });

    it('author label block has large gap from marginTop 3.5em', () => {
      const volLine = blocks[3];
      const authorLabel = blocks[4];
      if (!volLine || !authorLabel) return;
      const gap = authorLabel.bounds.y - (volLine.bounds.y + volLine.bounds.height);
      // authorLabel marginTop = 3.5em * own fontSize(12.8) = 44.8
      expect(gap).toBeCloseTo(12.8 * 3.5);
    });

    it('block heights are based on font-size * lineHeight', () => {
      // Each p has one line. Height = fontSize * lineHeight
      // First p: fontSize=27.2, lineHeight=1.3 → height=35.36
      const firstHeight = blocks[0]?.bounds.height ?? 0;
      expect(firstHeight).toBeCloseTo(27.2 * 1.3);
    });

    it('total layout height is reasonable', () => {
      const last = blocks[blocks.length - 1];
      if (!last) return;
      const totalHeight = last.bounds.y + last.bounds.height;
      // Should be significantly more than just 8 lines stacked
      // The 4em top margin + 3.5em author gap + 2em illustrator gap = substantial
      expect(totalHeight).toBeGreaterThan(200);
    });
  });
});
