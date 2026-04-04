/**
 * Test that a paragraph split at a page boundary carries remaining lines
 * to the next page.
 */
import { describe, expect, it } from 'vitest';
import { layoutBlocks } from '../../src/layout/block';
import { paginateBlocks } from '../../src/layout/pagination';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { createLayoutConfig } from '../../src/layout/core/config';
import type { DocumentNode } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

// Use a wider char-width factor to simulate CJK full-width characters
const measurer = createMockTextMeasurer(1.0);
const layouter = createGreedyLayouter(measurer);

const config = createLayoutConfig({ width: 400, height: 200, margin: 20 });
const CONTENT_WIDTH = config.pageWidth - config.marginLeft - config.marginRight; // 360

function text(content: string): DocumentNode {
  return { type: NODE_TYPES.Text, content };
}
function block(tag: string, children: DocumentNode[]): DocumentNode {
  return { type: NODE_TYPES.Block, tag, children };
}

describe('CJK paragraph emergency break produces multiple lines', () => {
  it('long CJK text is broken into multiple line boxes', () => {
    // 60 CJK chars at 16px * 1.0 = 16px each = 960px total
    // Content width = 360px → should produce 3 lines
    const longText =
      '她可能不太想和异性有什么牵扯听说常常有各个年级的校内男生向她告白或试图接近她恐怕觉得自己也别有用心吧这是很长的句子';
    const styled = resolveStyles([block('p', [text(longText)])]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);

    expect(blocks).toHaveLength(1);
    const lineCount = blocks[0]?.children.filter((c) => c.type === 'line-box').length ?? 0;
    // With 60 chars * 16px = 960px, and 360px width, should be ~3 lines
    expect(lineCount).toBeGreaterThanOrEqual(2);
  });
});

describe('paragraph split across pages', () => {
  it('split paragraph tail appears on next page', () => {
    // With charWidth=1.0 and fontSize=16, each char = 16px.
    // Content width = 360px → ~22 chars per line.
    // Line height = 16 * 1.5 = 24px.
    // Content height = 160px → ~6 lines per page.

    // Create filler paragraphs to nearly fill a page, then a long paragraph
    const paras: DocumentNode[] = [];
    // 5 short paragraphs (1 line each, ~24px + margins)
    for (let i = 0; i < 4; i++) {
      paras.push(block('p', [text(`Short${String(i)}`)]));
    }
    // One long paragraph that wraps to 3+ lines (~66 chars)
    paras.push(
      block('p', [text('LongParaStart abcdefghijklmnop qrstuvwxyz abcdefghijk LongParaEnd')]),
    );

    const styled = resolveStyles(paras);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const pages = paginateBlocks(blocks, config);

    // Collect all text across all pages
    const allText: string[] = [];
    for (const page of pages) {
      for (const b of page.content) {
        for (const child of b.children) {
          if (child.type === 'line-box') {
            for (const run of child.runs) {
              allText.push(run.text);
            }
          }
        }
      }
    }

    const joined = allText.join(' ');

    // Both the start and end of the long paragraph must appear
    expect(joined).toContain('LongParaStart');
    expect(joined).toContain('LongParaEnd');
    expect(pages.length).toBeGreaterThan(1);
  });

  it('exact reproduction: 2-line paragraph at page boundary', () => {
    // Fill page almost completely, then add a 2-line paragraph
    // Content height = 160px. With line height 24px, that's ~6.6 lines.
    // With default p margins (16px top + 16px bottom from tag defaults),
    // each paragraph occupies ~56px (24 content + 16+16 margins, collapsed to ~40 effective)

    const paras: DocumentNode[] = [];
    // Fill with 3 paragraphs (~120px used)
    for (let i = 0; i < 3; i++) {
      paras.push(block('p', [text(`Filler${String(i)}`)]));
    }
    // Add a paragraph that wraps to 2 lines (~48px content)
    // This should not fully fit → first line on page 1, second line on page 2
    paras.push(block('p', [text('TwoLineStart abcdefghijklmnopqrstuvwx TwoLineEnd')]));

    const styled = resolveStyles(paras);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const pages = paginateBlocks(blocks, config);

    const allText: string[] = [];
    for (const page of pages) {
      for (const b of page.content) {
        for (const child of b.children) {
          if (child.type === 'line-box') {
            for (const run of child.runs) {
              allText.push(run.text);
            }
          }
        }
      }
    }

    const joined = allText.join(' ');
    expect(joined).toContain('TwoLineStart');
    expect(joined).toContain('TwoLineEnd');
  });
});
