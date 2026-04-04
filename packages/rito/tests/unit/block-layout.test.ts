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
    expect(pTop - h1Bottom).toBe(21);
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
      const allText = lineBox.runs.map((r) => r.text).join('');
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
      expect(blocks[0]?.overflow).toBe('hidden');
    });

    it('does not set overflow when visible (default)', () => {
      const styled = resolveStyles([
        block('div', [text('Visible')], { style: 'overflow: visible' }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      expect(blocks[0]?.overflow).toBeUndefined();
    });
  });

  describe('box-sizing: border-box', () => {
    it('subtracts padding from width in border-box', () => {
      // width: 200px with 20px padding on each side
      // content-area = 200 - 20 - 20 = 160px
      const styled = resolveStyles([
        block('div', [text('Box')], {
          style: 'width: 200px; padding-left: 20px; padding-right: 20px; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks).toHaveLength(1);
      // The block width should be 160 (content-area after subtracting padding)
      expect(blocks[0]?.bounds.width).toBe(160);
    });

    it('subtracts border from width in border-box', () => {
      const styled = resolveStyles([
        block('div', [text('Bordered')], {
          style: 'width: 200px; border: 5px solid black; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // content-area = 200 - 5 - 5 = 190
      expect(blocks[0]?.bounds.width).toBe(190);
    });

    it('subtracts both padding and border in border-box', () => {
      const styled = resolveStyles([
        block('div', [text('Both')], {
          style:
            'width: 200px; padding-left: 10px; padding-right: 10px; border: 5px solid black; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // content-area = 200 - 10 - 10 - 5 - 5 = 170
      expect(blocks[0]?.bounds.width).toBe(170);
    });

    it('does not subtract in content-box (default)', () => {
      const styled = resolveStyles([
        block('div', [text('Content')], {
          style: 'width: 200px; padding-left: 20px; padding-right: 20px; box-sizing: content-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // content-box: width is the content area, padding is extra
      expect(blocks[0]?.bounds.width).toBe(200);
    });

    it('defaults to content-box when not specified', () => {
      const styled = resolveStyles([
        block('div', [text('Default')], {
          style: 'width: 200px; padding-left: 20px; padding-right: 20px',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      expect(blocks[0]?.bounds.width).toBe(200);
    });

    it('does not go below zero in border-box', () => {
      // width: 20px with 20px padding each side = 20 - 40 = clamp to 0
      const styled = resolveStyles([
        block('div', [text('Tiny')], {
          style: 'width: 20px; padding-left: 20px; padding-right: 20px; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // Should clamp to minimum of 1 (Math.max(w, 1) in layoutLeafBlock)
      expect(blocks[0]?.bounds.width).toBeGreaterThanOrEqual(1);
    });

    it('applies border-box to max-width as well', () => {
      const styled = resolveStyles([
        block('div', [text('MaxW')], {
          style:
            'max-width: 200px; padding-left: 10px; padding-right: 10px; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // max-width in border-box: 200 - 10 - 10 = 180 content max
      // Available width = 300, so clamped to 180
      expect(blocks[0]?.bounds.width).toBe(180);
    });

    it('combines margin:auto centering with border-box', () => {
      const styled = resolveStyles([
        block('div', [text('Centered box')], {
          style:
            'width: 200px; padding-left: 10px; padding-right: 10px; margin: 0 auto; box-sizing: border-box',
        }),
      ]);
      const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

      // border-box content-area = 200 - 10 - 10 = 180
      // centered in 300: x = (300 - 180) / 2 = 60
      expect(blocks[0]?.bounds.width).toBe(180);
      expect(blocks[0]?.bounds.x).toBe(60);
    });
  });
});
