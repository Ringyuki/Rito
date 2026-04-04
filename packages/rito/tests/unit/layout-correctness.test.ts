import { describe, expect, it } from 'vitest';
import { layoutBlocks } from '../../src/layout/block';
import { paginateBlocks } from '../../src/layout/pagination';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { resolveStyles } from '../../src/style/cascade/resolver';
import type { LineBox } from '../../src/layout/core/types';
import { createLayoutConfig } from '../../src/layout/core/config';
import type { DocumentNode } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const CONTENT_WIDTH = 360;

const CONFIG = createLayoutConfig({ width: 400, height: 600, margin: 20 });

function text(content: string): DocumentNode {
  return { type: NODE_TYPES.Text, content };
}

function block(tag: string, children: DocumentNode[]): DocumentNode {
  return { type: NODE_TYPES.Block, tag, children };
}

describe('layout correctness: no text overlap', () => {
  it('line boxes within a block do not overlap vertically', () => {
    const styled = resolveStyles([
      block('p', [text('Line one. Line two. Line three. Line four. Line five. Line six.')]),
    ]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const p = blocks[0];
    expect(p).toBeDefined();

    const lineBoxes = p?.children.filter((c): c is LineBox => c.type === 'line-box') ?? [];
    for (let i = 1; i < lineBoxes.length; i++) {
      const prev = lineBoxes[i - 1];
      const curr = lineBoxes[i];
      if (!prev || !curr) continue;
      // Current line's top should be at or after previous line's bottom
      expect(curr.bounds.y).toBeGreaterThanOrEqual(prev.bounds.y + prev.bounds.height);
    }
  });

  it('text runs within a line box have y=0 (relative to line box)', () => {
    const styled = resolveStyles([block('p', [text('Hello world')])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const lineBox = blocks[0]?.children[0];

    if (lineBox?.type === 'line-box') {
      for (const run of lineBox.runs) {
        expect(run.bounds.y).toBe(0);
      }
    }
  });

  it('adjacent blocks do not overlap vertically', () => {
    const styled = resolveStyles([
      block('p', [text('Paragraph one.')]),
      block('p', [text('Paragraph two.')]),
      block('p', [text('Paragraph three.')]),
    ]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    for (let i = 1; i < blocks.length; i++) {
      const prev = blocks[i - 1];
      const curr = blocks[i];
      if (!prev || !curr) continue;
      expect(curr.bounds.y).toBeGreaterThanOrEqual(prev.bounds.y + prev.bounds.height);
    }
  });
});

describe('layout correctness: container flattening', () => {
  it('section wrapping paragraphs produces individual blocks', () => {
    const styled = resolveStyles([
      block('section', [
        block('p', [text('Para 1')]),
        block('p', [text('Para 2')]),
        block('p', [text('Para 3')]),
      ]),
    ]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(3);
    // All blocks should have line-box children (text blocks, not containers)
    for (const b of blocks) {
      expect(b.children.length).toBeGreaterThan(0);
      expect(b.children[0]?.type).toBe('line-box');
    }
  });

  it('body > div > section > p flattens to individual paragraphs', () => {
    const styled = resolveStyles([block('div', [block('section', [block('p', [text('Deep')])])])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.children[0]?.type).toBe('line-box');
  });
});

describe('pagination correctness', () => {
  it('one long chapter produces multiple pages', () => {
    const paragraphs: DocumentNode[] = [];
    for (let i = 0; i < 30; i++) {
      paragraphs.push(block('p', [text(`Paragraph ${String(i)} with some text.`)]));
    }
    const styled = resolveStyles([block('section', paragraphs)]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const pages = paginateBlocks(blocks, CONFIG);

    expect(pages.length).toBeGreaterThan(1);
  });

  it('paragraph-level pagination: blocks from a wrapper are individually paginated', () => {
    const paragraphs: DocumentNode[] = [];
    for (let i = 0; i < 50; i++) {
      paragraphs.push(block('p', [text(`Line ${String(i)}`)]));
    }
    const styled = resolveStyles([block('div', paragraphs)]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const pages = paginateBlocks(blocks, CONFIG);

    // Should have multiple pages
    expect(pages.length).toBeGreaterThan(1);
    // All pages should have content
    for (const page of pages) {
      expect(page.content.length).toBeGreaterThan(0);
    }
    // No single page should contain all blocks
    for (const page of pages) {
      expect(page.content.length).toBeLessThan(blocks.length);
    }
  });

  it('page content blocks stay within content area height', () => {
    const contentHeight = CONFIG.pageHeight - CONFIG.marginTop - CONFIG.marginBottom;
    const paragraphs: DocumentNode[] = [];
    for (let i = 0; i < 40; i++) {
      paragraphs.push(block('p', [text(`Paragraph ${String(i)} content.`)]));
    }
    const styled = resolveStyles([block('section', paragraphs)]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const pages = paginateBlocks(blocks, CONFIG);

    for (const page of pages) {
      for (const b of page.content) {
        const bottom = b.bounds.y + b.bounds.height;
        expect(bottom).toBeLessThanOrEqual(contentHeight + 1);
      }
    }
  });
});
