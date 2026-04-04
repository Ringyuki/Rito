// @vitest-environment happy-dom
/**
 * Regression test for sentence cutoff at page boundaries.
 * Verifies that when a paragraph spans a page break, the remaining
 * lines appear on the next page (not lost).
 */
import { describe, expect, it } from 'vitest';
import { parseXhtml } from '../../src/parser/xhtml/xhtml-parser';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { layoutBlocks } from '../../src/layout/block';
import { paginateBlocks } from '../../src/layout/pagination';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { createLayoutConfig } from '../../src/layout/core/config';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);

// Small page: 300px content height (pageHeight=340, margins=20)
// Each line ~24px (fontSize=16, lineHeight=1.5), so ~12 lines per page
const config = createLayoutConfig({ width: 400, height: 340, margin: 20 });
const CONTENT_WIDTH = config.pageWidth - config.marginLeft - config.marginRight;
const CONTENT_HEIGHT = config.pageHeight - config.marginTop - config.marginBottom;

function xhtml(body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
  <head><title>Test</title></head>
  <body>${body}</body>
</html>`;
}

describe('pagination cutoff regression', () => {
  it('all text from all paragraphs appears across pages', () => {
    // Create 20 paragraphs, each with a unique marker word
    const paras = Array.from(
      { length: 20 },
      (_, i) => `<p>Paragraph${String(i)} with some additional text content here.</p>`,
    ).join('');

    const { nodes } = parseXhtml(xhtml(paras));
    const styled = resolveStyles(nodes);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const pages = paginateBlocks(blocks, config);

    // Collect all rendered text from all pages
    const allText: string[] = [];
    for (const page of pages) {
      for (const block of page.content) {
        for (const child of block.children) {
          if (child.type === 'line-box') {
            for (const run of child.runs) {
              allText.push(run.text);
            }
          }
        }
      }
    }

    const joinedText = allText.join(' ');

    // Every paragraph marker must appear somewhere
    for (let i = 0; i < 20; i++) {
      expect(joinedText).toContain(`Paragraph${String(i)}`);
    }
  });

  it('a long paragraph split across pages preserves all lines', () => {
    // One paragraph with many words, forcing multiple lines
    const words = Array.from({ length: 100 }, (_, i) => `word${String(i)}`).join(' ');
    const { nodes } = parseXhtml(xhtml(`<p>${words}</p>`));
    const styled = resolveStyles(nodes);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    // Count total line boxes before pagination
    let totalLinesBefore = 0;
    for (const block of blocks) {
      totalLinesBefore += block.children.filter((c) => c.type === 'line-box').length;
    }

    const pages = paginateBlocks(blocks, config);

    // Count total line boxes after pagination
    let totalLinesAfter = 0;
    for (const page of pages) {
      for (const block of page.content) {
        totalLinesAfter += block.children.filter((c) => c.type === 'line-box').length;
      }
    }

    // No lines should be lost
    expect(totalLinesAfter).toBe(totalLinesBefore);
    expect(pages.length).toBeGreaterThan(1);
  });

  it('last line of a page is not duplicated on next page', () => {
    const paras = Array.from({ length: 15 }, (_, i) => `<p>Line${String(i)}</p>`).join('');

    const { nodes } = parseXhtml(xhtml(paras));
    const styled = resolveStyles(nodes);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const pages = paginateBlocks(blocks, config);

    // Collect all paragraph texts in order
    const allTexts: string[] = [];
    for (const page of pages) {
      for (const block of page.content) {
        for (const child of block.children) {
          if (child.type === 'line-box') {
            for (const run of child.runs) {
              allTexts.push(run.text);
            }
          }
        }
      }
    }

    // Check no duplicates at page boundaries
    for (let i = 1; i < allTexts.length; i++) {
      if (allTexts[i] === allTexts[i - 1]) {
        throw new Error(`Duplicate text at boundary: "${String(allTexts[i])}"`);
      }
    }
  });

  it('page content stays within content height', () => {
    const paras = Array.from({ length: 20 }, (_, i) => `<p>Paragraph ${String(i)} text.</p>`).join(
      '',
    );

    const { nodes } = parseXhtml(xhtml(paras));
    const styled = resolveStyles(nodes);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const pages = paginateBlocks(blocks, config);

    for (const page of pages) {
      for (const block of page.content) {
        const bottom = block.bounds.y + block.bounds.height;
        expect(bottom).toBeLessThanOrEqual(CONTENT_HEIGHT + 0.01);
      }
    }
  });
});
