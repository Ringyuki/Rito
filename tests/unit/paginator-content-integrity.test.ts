/**
 * Verify that the paginator never loses content.
 * Compare total line count before and after pagination.
 */
import { describe, expect, it } from 'vitest';
import { layoutBlocks } from '../../src/layout/block-layout';
import { paginateBlocks } from '../../src/layout/paginator';
import { createGreedyLayouter } from '../../src/layout/greedy-line-breaker';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { resolveStyles } from '../../src/style/resolver';
import { createLayoutConfig } from '../../src/layout/config';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import { parseCssRules } from '../../src/style/css-rule-parser';
import type { DocumentNode } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';
import type { LayoutBlock } from '../../src/layout/types';

// CJK-like full-width measurement
const measurer = createMockTextMeasurer(1.0);
const layouter = createGreedyLayouter(measurer);

// Tight page: 200px content height (~9 lines at ~21px each)
const config = createLayoutConfig({ width: 600, height: 280, margin: 40 });
const CONTENT_WIDTH = config.pageWidth - config.marginLeft - config.marginRight;

const CSS = 'p { text-indent: 2em; line-height: 1.3em; margin-top: 0.4em; margin-bottom: 0.4em; }';
const rules = parseCssRules(CSS, DEFAULT_STYLE.fontSize);

function text(content: string): DocumentNode {
  return { type: NODE_TYPES.Text, content };
}
function block(tag: string, children: DocumentNode[]): DocumentNode {
  return { type: NODE_TYPES.Block, tag, children };
}

function countLines(blocks: readonly LayoutBlock[]): number {
  let count = 0;
  for (const b of blocks) {
    for (const c of b.children) {
      if (c.type === 'line-box') count++;
    }
  }
  return count;
}

describe('paginator content integrity', () => {
  it('no lines lost: many short paragraphs', () => {
    const paras: DocumentNode[] = [];
    for (let i = 0; i < 30; i++) {
      paras.push(block('p', [text(`Para${String(i)}`)]));
    }
    const styled = resolveStyles(paras, undefined, rules);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const linesBefore = countLines(blocks);

    const pages = paginateBlocks(blocks, config);
    let linesAfter = 0;
    for (const page of pages) {
      linesAfter += countLines(page.content);
    }

    expect(linesAfter).toBe(linesBefore);
  });

  it('no blank line boxes at top of page after split', () => {
    // Create content that forces a paragraph split
    const paras: DocumentNode[] = [];
    for (let i = 0; i < 3; i++) {
      paras.push(block('p', [text(`Fill${String(i)}`)]));
    }
    // Long paragraph that must split
    const longText = '这是一段很长的文本'.repeat(10);
    paras.push(block('p', [text(longText)]));

    const styled = resolveStyles(paras, undefined, rules);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const pages = paginateBlocks(blocks, config);

    // Check every page's first block's first line box for empty runs
    for (let p = 1; p < pages.length; p++) {
      const page = pages[p];
      if (!page || page.content.length === 0) continue;
      const firstBlock = page.content[0];
      if (!firstBlock || firstBlock.children.length === 0) continue;
      const firstChild = firstBlock.children[0];
      if (firstChild?.type === 'line-box') {
        // The first line box should have actual text content
        expect(firstChild.runs.length).toBeGreaterThan(0);
        const firstRunText = firstChild.runs[0]?.text ?? '';
        expect(firstRunText.trim().length).toBeGreaterThan(0);
        // The first line box should start at y=0 (no blank gap)
        expect(firstChild.bounds.y).toBe(0);
      }
    }
  });

  it('no lines lost: few long paragraphs with CJK-length text', () => {
    const paras: DocumentNode[] = [];
    for (let i = 0; i < 5; i++) {
      // ~80 chars → with text-indent and full-width chars, should be 3+ lines
      const longText = `开头${String(i)}${'这是一段很长的中文文本需要多行显示'.repeat(3)}结尾${String(i)}`;
      paras.push(block('p', [text(longText)]));
    }
    const styled = resolveStyles(paras, undefined, rules);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const linesBefore = countLines(blocks);

    const pages = paginateBlocks(blocks, config);
    let linesAfter = 0;
    for (const page of pages) {
      linesAfter += countLines(page.content);
    }

    expect(linesBefore).toBeGreaterThan(5); // multi-line paragraphs
    expect(linesAfter).toBe(linesBefore);
    expect(pages.length).toBeGreaterThan(1);

    // Also verify all start/end markers are present
    const allText: string[] = [];
    for (const page of pages) {
      for (const b of page.content) {
        for (const c of b.children) {
          if (c.type === 'line-box') {
            for (const run of c.runs) allText.push(run.text);
          }
        }
      }
    }
    const joined = allText.join('');
    for (let i = 0; i < 5; i++) {
      expect(joined).toContain(`开头${String(i)}`);
      expect(joined).toContain(`结尾${String(i)}`);
    }
  });
});
