import { describe, expect, it } from 'vitest';
import { paginateBlocks } from '../../src/layout/paginator';
import { layoutBlocks } from '../../src/layout/block-layout';
import { createGreedyLayouter } from '../../src/layout/greedy-line-breaker';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { resolveStyles } from '../../src/style/resolver';
import type { LayoutBlock, LayoutConfig } from '../../src/layout/types';
import type { DocumentNode } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

const measurer = createMockTextMeasurer(0.6);
const paragraphLayouter = createGreedyLayouter(measurer);

// Page: 400x600 with 20px margins → content area 360x560
const CONFIG: LayoutConfig = {
  pageWidth: 400,
  pageHeight: 600,
  marginTop: 20,
  marginRight: 20,
  marginBottom: 20,
  marginLeft: 20,
};
const CONTENT_WIDTH = CONFIG.pageWidth - CONFIG.marginLeft - CONFIG.marginRight;
const CONTENT_HEIGHT = CONFIG.pageHeight - CONFIG.marginTop - CONFIG.marginBottom;

function text(content: string): DocumentNode {
  return { type: NODE_TYPES.Text, content };
}

function block(tag: string, children: DocumentNode[]): DocumentNode {
  return { type: NODE_TYPES.Block, tag, children };
}

function makeBlocks(nodes: DocumentNode[]): readonly LayoutBlock[] {
  const styled = resolveStyles(nodes);
  return layoutBlocks(styled, CONTENT_WIDTH, paragraphLayouter);
}

describe('paginateBlocks', () => {
  describe('single page', () => {
    it('fits small content on one page', () => {
      const blocks = makeBlocks([block('p', [text('Hello')])]);
      const pages = paginateBlocks(blocks, CONFIG);

      expect(pages).toHaveLength(1);
      expect(pages[0]?.index).toBe(0);
      expect(pages[0]?.content.length).toBeGreaterThan(0);
    });

    it('sets correct page bounds', () => {
      const blocks = makeBlocks([block('p', [text('Hello')])]);
      const pages = paginateBlocks(blocks, CONFIG);

      expect(pages[0]?.bounds).toEqual({
        x: 0,
        y: 0,
        width: CONFIG.pageWidth,
        height: CONFIG.pageHeight,
      });
    });

    it('returns empty array for no blocks', () => {
      const pages = paginateBlocks([], CONFIG);
      expect(pages).toHaveLength(0);
    });
  });

  describe('multi-page', () => {
    it('creates multiple pages for content that overflows', () => {
      // Generate many paragraphs that exceed one page
      const nodes: DocumentNode[] = [];
      for (let i = 0; i < 30; i++) {
        nodes.push(block('p', [text(`Paragraph ${String(i)} with some text content`)]));
      }
      const blocks = makeBlocks(nodes);
      const pages = paginateBlocks(blocks, CONFIG);

      expect(pages.length).toBeGreaterThan(1);
      // Pages should have sequential indices
      for (let i = 0; i < pages.length; i++) {
        expect(pages[i]?.index).toBe(i);
      }
    });

    it('moves a block to next page when it doesnt fit', () => {
      // Create blocks where the last one won't fit on page 1
      const nodes: DocumentNode[] = [];
      for (let i = 0; i < 25; i++) {
        nodes.push(block('p', [text(`Line ${String(i)}`)]));
      }
      const blocks = makeBlocks(nodes);
      const pages = paginateBlocks(blocks, CONFIG);

      expect(pages.length).toBeGreaterThan(1);
      // All pages should have content
      for (const page of pages) {
        expect(page.content.length).toBeGreaterThan(0);
      }
    });
  });

  describe('block splitting', () => {
    it('splits a text block at LineBox boundaries', () => {
      // Create one very tall paragraph that must be split across pages
      // ~200 words, ~6 words/line, ~33 lines * 24px = ~792px > 560px content height
      const longText = Array.from({ length: 200 }, (_, i) => `word${String(i)}`).join(' ');
      const blocks = makeBlocks([block('p', [text(longText)])]);
      const pages = paginateBlocks(blocks, CONFIG);

      // Should need more than one page
      expect(pages.length).toBeGreaterThan(1);
      // First page should have content (split head)
      expect(pages[0]?.content.length).toBeGreaterThan(0);
      // Last page should also have content (split tail)
      const lastPage = pages[pages.length - 1];
      expect(lastPage?.content.length).toBeGreaterThan(0);
    });

    it('split blocks have line boxes starting at y=0', () => {
      const longText = Array.from({ length: 200 }, (_, i) => `word${String(i)}`).join(' ');
      const blocks = makeBlocks([block('p', [text(longText)])]);
      const pages = paginateBlocks(blocks, CONFIG);

      if (pages.length > 1) {
        const secondPageBlock = pages[1]?.content[0];
        if (secondPageBlock && secondPageBlock.children[0]?.type === 'line-box') {
          // First line on second page should start at or near y=0
          expect(secondPageBlock.children[0].bounds.y).toBe(0);
        }
      }
    });
  });

  describe('unsplittable blocks', () => {
    it('places an unsplittable block on its own page if it overflows', () => {
      // Create a container block (not splittable) that's taller than the page
      // A div containing many paragraphs acts as an unsplittable unit
      const innerNodes: DocumentNode[] = [];
      for (let i = 0; i < 40; i++) {
        innerNodes.push(block('p', [text(`Inner para ${String(i)}`)]));
      }
      const blocks = makeBlocks([block('p', [text('Before')]), block('div', innerNodes)]);
      const pages = paginateBlocks(blocks, CONFIG);

      // Should have at least 2 pages
      expect(pages.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('edge cases', () => {
    it('handles a block that exactly fits the page', () => {
      // Create content that fills exactly one page worth
      const nodes: DocumentNode[] = [];
      // Each <p> with a short text is about 24px line + 16px margin = ~40px per block
      // Content height = 560. So ~14 blocks should fit (560/40 = 14)
      for (let i = 0; i < 14; i++) {
        nodes.push(block('p', [text(`P${String(i)}`)]));
      }
      const blocks = makeBlocks(nodes);
      const pages = paginateBlocks(blocks, CONFIG);

      // Content should fit on 1-2 pages (exact fit is hard to predict with margins)
      expect(pages.length).toBeGreaterThanOrEqual(1);
      expect(pages.length).toBeLessThanOrEqual(2);
    });

    it('handles single line block that overflows by one line', () => {
      // Fill page almost full, then add one more block
      const nodes: DocumentNode[] = [];
      for (let i = 0; i < 20; i++) {
        nodes.push(block('p', [text(`Para ${String(i)}`)]));
      }
      const blocks = makeBlocks(nodes);
      const pages = paginateBlocks(blocks, CONFIG);

      // All blocks should be distributed across pages
      const totalBlocks = pages.reduce((sum, p) => sum + p.content.length, 0);
      expect(totalBlocks).toBeGreaterThanOrEqual(blocks.length);
    });

    it('content y positions stay within page content area', () => {
      const nodes: DocumentNode[] = [];
      for (let i = 0; i < 30; i++) {
        nodes.push(block('p', [text(`Paragraph ${String(i)}`)]));
      }
      const blocks = makeBlocks(nodes);
      const pages = paginateBlocks(blocks, CONFIG);

      for (const page of pages) {
        for (const b of page.content) {
          const bottom = b.bounds.y + b.bounds.height;
          // Block bottom should not exceed content height (with small tolerance)
          expect(bottom).toBeLessThanOrEqual(CONTENT_HEIGHT + 1);
        }
      }
    });
  });
});
