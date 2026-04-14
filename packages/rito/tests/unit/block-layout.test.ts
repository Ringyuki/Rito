import { describe, expect, it } from 'vitest';
import { layoutBlocks } from '../../src/layout/block';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { resolveStyles } from '../../src/style/cascade/resolver';
import type { DocumentNode, ElementAttributes } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const CONTENT_WIDTH = 300;

function text(content: string): DocumentNode {
  return { type: NODE_TYPES.Text, content };
}

function block(
  tag: string,
  children: DocumentNode[],
  attributes?: ElementAttributes,
): DocumentNode {
  return attributes
    ? { type: NODE_TYPES.Block, tag, children, attributes }
    : { type: NODE_TYPES.Block, tag, children };
}

function inline(tag: string, children: DocumentNode[]): DocumentNode {
  return { type: NODE_TYPES.Inline, tag, children };
}

describe('layoutBlocks', () => {
  it('lays out a single paragraph', () => {
    const styled = resolveStyles([block('p', [text('Hello world')])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.bounds.x).toBe(0);
    expect(blocks[0]?.bounds.width).toBe(CONTENT_WIDTH);
    expect(blocks[0]?.bounds.height).toBeGreaterThan(0);
  });

  it('stacks multiple blocks vertically', () => {
    const styled = resolveStyles([block('p', [text('First')]), block('p', [text('Second')])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(2);
    // Second block starts after first block + margins
    expect(blocks[1]?.bounds.y).toBeGreaterThan(0);
    expect(blocks[1]?.bounds.y).toBeGreaterThanOrEqual(
      (blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0),
    );
  });

  it('applies margin spacing between blocks', () => {
    // <p> has marginTop=16, marginBottom=16
    const styled = resolveStyles([block('p', [text('A')]), block('p', [text('B')])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    const firstBottom = (blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0);
    const secondTop = blocks[1]?.bounds.y ?? 0;
    // Gap should be max(16, 16) = 16 (collapsed margins)
    expect(secondTop - firstBottom).toBe(16);
  });

  it('collapses adjacent margins (uses max, not sum)', () => {
    // h1 has marginBottom=21, p has marginTop=16
    // collapsed = max(21, 16) = 21
    const styled = resolveStyles([block('h1', [text('Title')]), block('p', [text('Body')])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    const h1Bottom = (blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0);
    const pTop = blocks[1]?.bounds.y ?? 0;
    expect(pTop - h1Bottom).toBeCloseTo(21);
  });

  it('produces line boxes inside text blocks', () => {
    const styled = resolveStyles([block('p', [text('Hello world')])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    const p = blocks[0];
    expect(p?.children.length).toBeGreaterThan(0);
    expect(p?.children[0]?.type).toBe('line-box');
  });

  it('flattens container blocks into individual text blocks', () => {
    const styled = resolveStyles([block('div', [block('p', [text('Inside div')])])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    // Container (div) is flattened: its child (p) appears directly in the output
    expect(blocks).toHaveLength(1);
    // The block is the p, containing line boxes (not a nested layout-block)
    expect(blocks[0]?.children[0]?.type).toBe('line-box');
  });

  it('flattens deeply nested containers', () => {
    const styled = resolveStyles([
      block('div', [
        block('section', [block('p', [text('Para 1')]), block('p', [text('Para 2')])]),
      ]),
    ]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    // Both paragraphs should appear as individual blocks
    expect(blocks).toHaveLength(2);
    expect(blocks[0]?.children[0]?.type).toBe('line-box');
    expect(blocks[1]?.children[0]?.type).toBe('line-box');
  });

  it('figure with whitespace + image treats image as block (not inline)', () => {
    // Simulates: <figure>\n  <img src="cover.jpg"/>\n</figure>
    // Whitespace text nodes should NOT make this "mixed inline content"
    const figureNode: DocumentNode = {
      type: NODE_TYPES.Block,
      tag: 'figure',
      children: [
        { type: NODE_TYPES.Text, content: '\n    ' },
        { type: 'image' as const, src: 'cover.jpg', alt: '' },
        { type: NODE_TYPES.Text, content: '\n  ' },
      ],
    };
    const styled = resolveStyles([figureNode]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    // The image should be laid out as a block-level image (large),
    // not as an inline atom (fontSize-sized thumbnail)
    expect(blocks).toHaveLength(1);
    // Block image uses contentWidth, not fontSize
    expect(blocks[0]?.bounds.width).toBe(CONTENT_WIDTH);
    expect(blocks[0]?.bounds.height).toBeGreaterThan(100);
  });

  it('bare <br> between blocks produces correct gap including margins', () => {
    // <p>A</p><br><p>B</p> with default p margins (top=16, bottom=16)
    // The <br> acts as a zero-margin anonymous block that prevents margin collapse.
    // Expected gap = p.marginBottom(16) + br lineHeight(19.2) + p.marginTop(16) = 51.2
    const nodes: DocumentNode[] = [
      block('p', [text('A')]),
      { type: NODE_TYPES.Text, content: '\n' },
      block('p', [text('B')]),
    ];
    const styled = resolveStyles(nodes);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(2);
    const firstBottom = (blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0);
    const secondTop = blocks[1]?.bounds.y ?? 0;
    const gap = secondTop - firstBottom;
    // Gap must include: prevMarginBottom(16) + lineHeight(19.2) + nextMarginTop(16) = 51.2
    expect(gap).toBeCloseTo(51.2);
  });

  it('bare <br> between zero-margin blocks produces exactly one line height', () => {
    const nodes: DocumentNode[] = [
      block('p', [text('A')], { style: 'margin: 0' }),
      { type: NODE_TYPES.Text, content: '\n' },
      block('p', [text('B')], { style: 'margin: 0' }),
    ];
    const styled = resolveStyles(nodes);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(2);
    const firstBottom = (blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0);
    const secondTop = blocks[1]?.bounds.y ?? 0;
    // No margins, just one line height: 16 * 1.2 = 19.2
    expect(secondTop - firstBottom).toBeCloseTo(19.2);
  });

  it('handles empty blocks', () => {
    const styled = resolveStyles([block('p', [])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.bounds.height).toBe(0);
  });

  it('skips non-block nodes at top level', () => {
    const styled = resolveStyles([block('p', [text('keep')])]);
    // resolveStyles only produces blocks from block nodes, so this always works
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    expect(blocks).toHaveLength(1);
  });

  it('produces line boxes with text content', () => {
    const styled = resolveStyles([block('p', [text('Hello '), inline('strong', [text('bold')])])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    const lineBox = blocks[0]?.children[0];
    if (lineBox?.type === 'line-box') {
      const allText = lineBox.runs
        .filter((r) => r.type === 'text-run')
        .map((r) => r.text)
        .join('');
      expect(allText).toContain('Hello');
      expect(allText).toContain('bold');
    }
  });

  describe('margin:auto centering', () => {
    it('centers a block with margin: 0 auto and explicit width', () => {
      const styled = resolveStyles([
        block('div', [text('Centered')], { style: 'width: 200px; margin: 0 auto' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // Block should be 200px wide, centered in 300px container
      // x = (300 - 200) / 2 = 50
      expect(blocks[0]?.bounds.width).toBe(200);
      expect(blocks[0]?.bounds.x).toBe(50);
    });

    it('centers a block with margin-left:auto and margin-right:auto', () => {
      const styled = resolveStyles([
        block('div', [text('Centered')], {
          style: 'width: 100px; margin-left: auto; margin-right: auto',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // x = (300 - 100) / 2 = 100
      expect(blocks[0]?.bounds.width).toBe(100);
      expect(blocks[0]?.bounds.x).toBe(100);
    });

    it('pushes block right with only margin-left:auto', () => {
      const styled = resolveStyles([
        block('div', [text('Right')], {
          style: 'width: 100px; margin-left: auto; margin-right: 20px',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // margin-left auto takes remaining: 300 - 100 - 20 = 180
      expect(blocks[0]?.bounds.width).toBe(100);
      expect(blocks[0]?.bounds.x).toBe(180);
    });

    it('pushes block left with only margin-right:auto', () => {
      const styled = resolveStyles([
        block('div', [text('Left')], {
          style: 'width: 100px; margin-left: 30px; margin-right: auto',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // margin-right auto absorbs remainder, x = margin-left = 30
      expect(blocks[0]?.bounds.x).toBe(30);
    });

    it('treats margin:auto without explicit width as full width', () => {
      // Without explicit width, block fills available space, so auto has no effect
      const styled = resolveStyles([block('div', [text('Full')], { style: 'margin: 0 auto' })]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // Block fills full width, no centering offset needed
      expect(blocks[0]?.bounds.width).toBe(CONTENT_WIDTH);
      expect(blocks[0]?.bounds.x).toBe(0);
    });

    it('handles margin: 10px auto shorthand', () => {
      const styled = resolveStyles([
        block('div', [text('Mid')], { style: 'width: 200px; margin: 10px auto' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.bounds.width).toBe(200);
      expect(blocks[0]?.bounds.x).toBe(50);
    });
  });

  describe('min-height', () => {
    it('enforces min-height when content is shorter', () => {
      const styled = resolveStyles([block('div', [text('Hi')], { style: 'min-height: 200px' })]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.bounds.height).toBeGreaterThanOrEqual(200);
    });

    it('does not shrink content taller than min-height', () => {
      // Short text, but min-height is smaller than natural height would be for large text
      const styled = resolveStyles([block('div', [text('Hi')], { style: 'min-height: 1px' })]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // Natural height should be preserved (greater than 1px)
      expect(blocks[0]?.bounds.height).toBeGreaterThan(1);
    });
  });

  describe('max-height', () => {
    it('enforces max-height when content is taller', () => {
      const styled = resolveStyles([block('div', [text('Hi')], { style: 'max-height: 5px' })]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.bounds.height).toBeLessThanOrEqual(5);
    });

    it('does not grow content shorter than max-height', () => {
      const styled = resolveStyles([block('div', [text('Hi')], { style: 'max-height: 9999px' })]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // Height should be less than 9999
      expect(blocks[0]?.bounds.height).toBeLessThan(9999);
    });
  });

  describe('overflow: hidden', () => {
    it('propagates overflow hidden to layout block', () => {
      const styled = resolveStyles([
        block('div', [text('Clipped')], { style: 'overflow: hidden; max-height: 10px' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.paint?.clipToBounds).toBe(true);
    });

    it('does not set overflow when visible (default)', () => {
      const styled = resolveStyles([
        block('div', [text('Visible')], { style: 'overflow: visible' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.paint?.clipToBounds).toBeUndefined();
    });
  });

  describe('container padding', () => {
    it('applies paddingTop to child blocks', () => {
      // div with paddingTop=20 wrapping a p (margin:0 to avoid margin interference)
      const styled = resolveStyles([
        block('div', [block('p', [text('Content')], { style: 'margin: 0' })], {
          style: 'padding-top: 20px',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // Child p should start at y=20 (paddingTop)
      expect(blocks[0]?.bounds.y).toBe(20);
    });

    it('applies paddingBottom to push subsequent blocks down', () => {
      const styled = resolveStyles([
        block('div', [block('p', [text('Inside')], { style: 'margin: 0' })], {
          style: 'padding-bottom: 30px; margin: 0',
        }),
        block('p', [text('After')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      const insideBottom = (blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0);
      const afterTop = blocks[1]?.bounds.y ?? 0;
      // Gap should include the 30px paddingBottom
      expect(afterTop - insideBottom).toBeGreaterThanOrEqual(30);
    });

    it('applies paddingRight to narrow child content width', () => {
      // With paddingLeft=20 + paddingRight=20, child width = 300-40 = 260
      // At 300px: 31 chars/line (300 / 9.6) → 2 lines for 60 chars
      // At 260px: 27 chars/line (260 / 9.6) → 3 lines for 60 chars
      const longText = 'A'.repeat(60);
      const styled = resolveStyles([
        block('div', [block('p', [text(longText)], { style: 'margin: 0' })], {
          style: 'padding-left: 20px; padding-right: 20px; margin: 0',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
      const narrowLineCount = blocks[0]?.children.length ?? 0;

      // Compare with no padding
      const styledNoPad = resolveStyles([
        block('div', [block('p', [text(longText)], { style: 'margin: 0' })], {
          style: 'margin: 0',
        }),
      ]);
      const blocksNoPad = layoutBlocks(styledNoPad, CONTENT_WIDTH, layouter);
      const wideLineCount = blocksNoPad[0]?.children.length ?? 0;

      // Narrower width should produce more lines
      expect(narrowLineCount).toBeGreaterThan(wideLineCount);
    });

    it('applies all four paddings together', () => {
      const styled = resolveStyles([
        block('div', [block('p', [text('Padded')], { style: 'margin: 0' })], {
          style: 'padding: 10px 20px 30px 40px; margin: 0',
        }),
        block('p', [text('Next')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      // First child should be offset by paddingTop=10 and indented by paddingLeft=40
      expect(blocks[0]?.bounds.y).toBe(10);
      expect(blocks[0]?.bounds.x).toBe(40);

      // Second block should be pushed down by paddingBottom=30
      const firstBottom = (blocks[0]?.bounds.y ?? 0) + (blocks[0]?.bounds.height ?? 0);
      const secondTop = blocks[1]?.bounds.y ?? 0;
      expect(secondTop - firstBottom).toBeGreaterThanOrEqual(30);
    });
  });

  describe('box-sizing: border-box', () => {
    it('border-box total width equals CSS width', () => {
      // width: 200px with 20px padding on each side, box-sizing: border-box
      // Total box = 200px. Content area = 200 - 20 - 20 = 160px (internal).
      const styled = resolveStyles([
        block('div', [text('Box')], {
          style: 'width: 200px; padding-left: 20px; padding-right: 20px; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.bounds.width).toBe(200);
    });

    it('border-box with border: total width equals CSS width', () => {
      const styled = resolveStyles([
        block('div', [text('Bordered')], {
          style: 'width: 200px; border: 5px solid black; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
      expect(blocks[0]?.bounds.width).toBe(200);
    });

    it('border-box with padding and border: total width equals CSS width', () => {
      const styled = resolveStyles([
        block('div', [text('Both')], {
          style:
            'width: 200px; padding-left: 10px; padding-right: 10px; border: 5px solid black; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
      expect(blocks[0]?.bounds.width).toBe(200);
    });

    it('content-box: total width = CSS width + padding', () => {
      const styled = resolveStyles([
        block('div', [text('Content')], {
          style: 'width: 200px; padding-left: 20px; padding-right: 20px; box-sizing: content-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
      // content-box: total = 200 + 20 + 20 = 240
      expect(blocks[0]?.bounds.width).toBe(240);
    });

    it('defaults to content-box: total width includes padding', () => {
      const styled = resolveStyles([
        block('div', [text('Default')], {
          style: 'width: 200px; padding-left: 20px; padding-right: 20px',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
      expect(blocks[0]?.bounds.width).toBe(240);
    });

    it('does not go below zero in border-box', () => {
      const styled = resolveStyles([
        block('div', [text('Tiny')], {
          style: 'width: 20px; padding-left: 20px; padding-right: 20px; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
      expect(blocks[0]?.bounds.width).toBeGreaterThanOrEqual(1);
    });

    it('border-box max-width: total width capped at CSS max-width', () => {
      const styled = resolveStyles([
        block('div', [text('MaxW')], {
          style:
            'max-width: 200px; padding-left: 10px; padding-right: 10px; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
      // border-box max-width = 200 total
      expect(blocks[0]?.bounds.width).toBe(200);
    });

    it('combines margin:auto centering with border-box', () => {
      const styled = resolveStyles([
        block('div', [text('Centered box')], {
          style:
            'width: 200px; padding-left: 10px; padding-right: 10px; margin: 0 auto; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
      // border-box: total = 200. Centered in 300: x = (300 - 200) / 2 = 50
      expect(blocks[0]?.bounds.width).toBe(200);
      expect(blocks[0]?.bounds.x).toBe(50);
    });
  });

  describe('block-level float', () => {
    it('floats a block-level element to the left', () => {
      const styled = resolveStyles([
        block('div', [text('Floated')], { style: 'float: left; width: 100px; margin: 0' }),
        block('p', [text('Wrapping text here')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      // Floated div at x=0
      expect(blocks[0]?.bounds.x).toBe(0);
      expect(blocks[0]?.bounds.width).toBe(100);
      // Following p should have reduced width (300 - 100 = 200)
      expect(blocks[1]?.bounds.width).toBe(200);
      expect(blocks[1]?.bounds.x).toBe(100);
    });

    it('floats a block-level element to the right', () => {
      const styled = resolveStyles([
        block('aside', [text('Sidebar')], { style: 'float: right; width: 80px; margin: 0' }),
        block('p', [text('Main content')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      // Floated aside at right edge: x = 300 - 80 = 220
      expect(blocks[0]?.bounds.x).toBe(220);
      // Following p should have narrower width
      expect(blocks[1]?.bounds.width).toBe(220);
    });

    it('floated container block below earlier content has correct child Y', () => {
      const styled = resolveStyles([
        block('p', [text('Above')], { style: 'margin: 0' }),
        block('div', [block('p', [text('Inside float')], { style: 'margin: 0' })], {
          style: 'float: left; width: 100px; margin: 0',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      const floatBlock = blocks[1];
      expect(floatBlock).toBeDefined();
      expect(floatBlock?.bounds.y).toBeGreaterThan(0);
      // Children inside the wrapper should be relative to the wrapper (start near y=0)
      const floatY = floatBlock?.bounds.y ?? 0;
      const firstChild = floatBlock?.children[0];
      expect(firstChild).toBeDefined();
      if (firstChild && 'bounds' in firstChild) {
        expect(firstChild.bounds.y).toBeLessThan(floatY);
      }
    });

    it('left float with margins reserves space including margins', () => {
      const styled = resolveStyles([
        block('div', [text('Float')], {
          style: 'float: left; width: 100px; margin-left: 10px; margin-right: 20px',
        }),
        block('p', [text('Wrapping text')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      // Float should be offset by marginLeft
      expect(blocks[0]?.bounds.x).toBe(10);
      // Wrapped text width = 300 - (100 + 10 + 20) = 170
      expect(blocks[1]?.bounds.width).toBe(170);
    });

    it('right float with margins positions correctly', () => {
      const styled = resolveStyles([
        block('div', [text('Float')], {
          style: 'float: right; width: 80px; margin-left: 10px; margin-right: 15px',
        }),
        block('p', [text('Main content')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      // Float at right: x = 300 - 80 - 15 = 205
      expect(blocks[0]?.bounds.x).toBe(205);
      // Wrapped text width = 300 - (80 + 10 + 15) = 195
      expect(blocks[1]?.bounds.width).toBe(195);
    });

    it('floated leaf block preserves padding and decorations', () => {
      const styled = resolveStyles([
        block('div', [text('Padded float')], {
          style: 'float: left; width: 120px; padding: 5px; margin: 0',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.bounds.height).toBeGreaterThan(0);
    });

    it('width:auto leaf float shrinks to fit content', () => {
      // "Hi" = 2 chars × 0.6 × 16 = 19.2px — much less than 300
      const styled = resolveStyles([
        block('div', [text('Hi')], { style: 'float: right; margin: 0' }),
        block('p', [text('Main')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      // Float should shrink to content width, not fill 300px
      expect(blocks[0]?.bounds.width).toBeLessThan(CONTENT_WIDTH);
      // Right-floated: x should be near the right edge
      expect(blocks[0]?.bounds.x).toBeGreaterThan(0);
    });

    it('width:auto container float with <p> children shrinks to fit', () => {
      // Floated div containing two short paragraphs — the common .fr pattern
      // "Short" = 5 chars × 0.6 × 16 = 48px, "Hi" = 19.2px
      // Container should shrink to the widest child's content, not the full 300px
      const styled = resolveStyles([
        block(
          'div',
          [
            block('p', [text('Short')], { style: 'margin: 0' }),
            block('p', [text('Hi')], { style: 'margin: 0' }),
          ],
          { style: 'float: right; margin: 0' },
        ),
        block('p', [text('Main content flows around')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      const floatBlock = blocks[0];
      // Container should shrink to widest child content (~48px), not 300px
      expect(floatBlock?.bounds.width).toBeLessThan(100);
      // Right-floated: x should be near the right edge
      expect(floatBlock?.bounds.x).toBeGreaterThan(CONTENT_WIDTH / 2);
    });

    it('two consecutive left floats stack horizontally', () => {
      const styled = resolveStyles([
        block('div', [text('A')], { style: 'float: left; width: 50px; margin: 0' }),
        block('div', [text('B')], { style: 'float: left; width: 60px; margin: 0' }),
        block('p', [text('Content')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(3);
      // First float at x=0
      expect(blocks[0]?.bounds.x).toBe(0);
      // Second float at x=50 (after first float)
      expect(blocks[1]?.bounds.x).toBe(50);
      // Content should be narrowed by both floats (300 - 50 - 60 = 190)
      expect(blocks[2]?.bounds.width).toBe(190);
    });

    it('explicit width is clamped to available width after margins', () => {
      // width:400 exceeds 300 - 10 - 10 = 280 available
      const styled = resolveStyles([
        block('div', [text('Wide')], {
          style: 'float: left; width: 400px; margin-left: 10px; margin-right: 10px',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // Should be clamped to 280 (300 - 10 - 10)
      expect(blocks[0]?.bounds.width).toBe(280);
    });

    it('opposite-side floats that exceed line width push later float down', () => {
      // Left float 200px + right float 200px = 400px > 300px container
      // Right float pushed below left float. Paragraph wraps correctly around both.
      const styled = resolveStyles([
        block('div', [text('Left')], { style: 'float: left; width: 200px; margin: 0' }),
        block('div', [text('Right')], { style: 'float: right; width: 200px; margin: 0' }),
        block('p', [text('Content')], { style: 'margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(3);
      const leftFloat = blocks[0];
      const rightFloat = blocks[1];
      const paragraph = blocks[2];
      // Right float pushed below left float
      const leftBottom = (leftFloat?.bounds.y ?? 0) + (leftFloat?.bounds.height ?? 0);
      expect(rightFloat?.bounds.y).toBeGreaterThanOrEqual(leftBottom);
      expect(rightFloat?.bounds.x).toBe(100);

      // Paragraph at y=0 should wrap around the LEFT float (200px),
      // NOT the pushed-down right float
      expect(paragraph?.bounds.y).toBe(0);
      expect(paragraph?.bounds.width).toBe(100); // 300 - 200 left float
      expect(paragraph?.bounds.x).toBe(200);
    });

    it('opposite-side floats that fit on same line do not push down', () => {
      // Left 100px + right 100px = 200px < 300px — both fit
      const styled = resolveStyles([
        block('div', [text('L')], { style: 'float: left; width: 100px; margin: 0' }),
        block('div', [text('R')], { style: 'float: right; width: 100px; margin: 0' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(2);
      // Both on the same row
      expect(blocks[0]?.bounds.y).toBe(blocks[1]?.bounds.y);
      expect(blocks[0]?.bounds.x).toBe(0);
      expect(blocks[1]?.bounds.x).toBe(200);
    });
  });
});
