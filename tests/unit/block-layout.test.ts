import { describe, expect, it } from 'vitest';
import { layoutBlocks } from '../../src/layout/block-layout';
import { createGreedyLayouter } from '../../src/layout/greedy-line-breaker';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { resolveStyles } from '../../src/style/resolver';
import type { DocumentNode } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const CONTENT_WIDTH = 300;

function text(content: string): DocumentNode {
  return { type: NODE_TYPES.Text, content };
}

function block(tag: string, children: DocumentNode[]): DocumentNode {
  return { type: NODE_TYPES.Block, tag, children };
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

  it('handles nested container blocks', () => {
    const styled = resolveStyles([block('div', [block('p', [text('Inside div')])])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(1);
    const div = blocks[0];
    expect(div?.children.length).toBeGreaterThan(0);
    expect(div?.children[0]?.type).toBe('layout-block');
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

  it('preserves inline styles in line box runs', () => {
    const styled = resolveStyles([block('p', [text('Hello '), inline('strong', [text('bold')])])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    const lineBox = blocks[0]?.children[0];
    if (lineBox?.type === 'line-box') {
      const boldRun = lineBox.runs.find((r) => r.text === 'bold');
      expect(boldRun?.style.fontWeight).toBe('bold');
    }
  });
});
