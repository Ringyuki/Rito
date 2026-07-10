// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { layoutBlocks } from '../../src/reference/ts-core/layout/block';
import { createLayoutConfig } from '../../src/reference/ts-core/layout/core/config';
import type { LayoutBlock, TextRun } from '../../src/reference/ts-core/layout/core/types';
import { createGreedyLayouter } from '../../src/reference/ts-core/layout/line-breaker/greedy';
import { createKnuthPlassLayouter } from '../../src/reference/ts-core/layout/line-breaker/kp';
import {
  flattenInlineContent,
  isInlineAtom,
} from '../../src/reference/ts-core/layout/text/styled-segment';
import { parseXhtml } from '../../src/reference/ts-core/parser/xhtml/xhtml-parser';
import {
  paginateChapterNodes,
  preparePaginationContext,
} from '../../src/reference/ts-core/runtime/pagination-core';
import { resolveStyles } from '../../src/reference/ts-core/style/cascade/resolver';
import { DEFAULT_STYLE } from '../../src/reference/ts-core/style/core/defaults';
import { parseCssRules } from '../../src/reference/ts-core/style/css/rule-parser';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

const measurer = createMockTextMeasurer(0.6);

function chapter(head: string, body: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head>${head}</head><body class="reader">${body}</body></html>`;
}

function textRuns(blocks: readonly LayoutBlock[]): TextRun[] {
  const runs: TextRun[] = [];
  const visit = (block: LayoutBlock): void => {
    for (const child of block.children) {
      if (child.type === 'layout-block') visit(child);
      else if (child.type === 'line-box') {
        for (const run of child.runs) if (run.type === 'text-run') runs.push(run);
      }
    }
  };
  for (const block of blocks) visit(block);
  return runs;
}

describe('typography pipeline regressions', () => {
  it('uses configured rootFontSize as the inherited reader font size', () => {
    const parsed = parseXhtml(chapter('', '<p>Hello</p>'));
    const config = createLayoutConfig({ width: 400, height: 300, rootFontSize: 32 });
    const context = preparePaginationContext(config, measurer, new Map());
    const result = paginateChapterNodes(parsed.nodes, config, context, 0, parsed.bodyAttributes);

    const runs = result.pages.flatMap((page) => textRuns(page.content));
    expect(runs[0]?.paint.font.sizePx).toBe(32);
  });

  it('keeps rem tied to the computed html root and exposes body/html as selector ancestors', () => {
    const parsed = parseXhtml(chapter('', '<p>Hello</p>'));
    const css = `
      html { font-size: 20px; }
      body.reader { font-size: 2rem; }
      html body.reader > p { font-size: 1rem; color: #123456; }
    `;
    const config = createLayoutConfig({ width: 400, height: 300, rootFontSize: 30 });
    const context = preparePaginationContext(config, measurer, new Map([['book.css', css]]));
    const result = paginateChapterNodes(parsed.nodes, config, context, 0, parsed.bodyAttributes);

    const run = result.pages.flatMap((page) => textRuns(page.content))[0];
    expect(run?.paint.font.sizePx).toBe(20);
    expect(run?.paint.color).toBe('#123456');
  });

  it('cascades body rules by specificity instead of stylesheet scan order', () => {
    const parsed = parseXhtml(chapter('', '<p>Hello</p>'));
    const css = 'body.reader { font-size: 22px; } body { font-size: 40px; }';
    const config = createLayoutConfig({ width: 400, height: 300 });
    const context = preparePaginationContext(config, measurer, new Map([['book.css', css]]));
    const result = paginateChapterNodes(parsed.nodes, config, context, 0, parsed.bodyAttributes);

    const run = result.pages.flatMap((page) => textRuns(page.content))[0];
    expect(run?.paint.font.sizePx).toBe(22);
  });

  it('applies chapter-local style elements and rejects ambiguous suffix stylesheet matches', () => {
    const parsed = parseXhtml(
      chapter('<style>body.reader p { font-size: 26px; }</style>', '<p>Hello</p>'),
    );
    const config = createLayoutConfig({ width: 400, height: 300 });
    const context = preparePaginationContext(
      config,
      measurer,
      new Map([
        ['A/theme.css', 'p { color: red; }'],
        ['B/theme.css', 'p { color: blue; }'],
      ]),
    );
    const result = paginateChapterNodes(
      parsed.nodes,
      config,
      context,
      0,
      parsed.bodyAttributes,
      ['../theme.css'],
      parsed.embeddedStylesheets,
    );

    const run = result.pages.flatMap((page) => textRuns(page.content))[0];
    expect(run?.paint.font.sizePx).toBe(26);
    expect(run?.paint.color).toBe('#000000');
  });

  it('resolves white-space after cascade and collapses spaces across inline boundaries', () => {
    const parsed = parseXhtml(
      chapter('', '<p class="pre">a   \n  b</p><p>a <span> b</span></p><p>a <img src="x" /> b</p>'),
    );
    const rules = parseCssRules('.pre { white-space: pre-wrap; }', 16);
    const styled = resolveStyles(parsed.nodes, undefined, rules);
    const first = styled[0];
    const second = styled[1];
    const third = styled[2];
    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(third).toBeDefined();
    if (!first || !second || !third) return;

    const preserved = flattenInlineContent(first.children)
      .map((segment) => (isInlineAtom(segment) ? '' : segment.text))
      .join('');
    const collapsed = flattenInlineContent(second.children)
      .map((segment) => (isInlineAtom(segment) ? '' : segment.text))
      .join('');
    expect(preserved).toBe('a   \n  b');
    expect(collapsed).toBe('a b');
    const aroundImage = flattenInlineContent(third.children).filter(
      (segment) => !isInlineAtom(segment),
    );
    expect(aroundImage.map((segment) => ('text' in segment ? segment.text : ''))).toEqual([
      'a ',
      ' b',
    ]);
  });

  it('lays out anonymous top-level and container inline runs instead of dropping them', () => {
    const parsed = parseXhtml(chapter('', 'lead<div>before<p>middle</p>after</div>tail'));
    const styled = resolveStyles(parsed.nodes);
    const blocks = layoutBlocks(styled, 300, createGreedyLayouter(measurer));

    expect(
      textRuns(blocks)
        .map((run) => run.text)
        .join(''),
    ).toContain('leadbeforemiddleaftertail');
  });

  it('keeps an anonymous top-level inline containing only a replaced element', () => {
    const parsed = parseXhtml(chapter('', '<a href="#target"><img src="cover.png" /></a>'));
    const blocks = layoutBlocks(resolveStyles(parsed.nodes), 300, createGreedyLayouter(measurer));

    const firstLine = blocks[0]?.children[0];
    expect(firstLine?.type).toBe('line-box');
    expect(firstLine?.type === 'line-box' ? firstLine.runs[0]?.type : undefined).toBe(
      'inline-atom',
    );
  });

  it('carries source offsets across optimal line breaks', () => {
    const source = 'alpha beta gamma delta epsilon zeta eta theta';
    const lines = createKnuthPlassLayouter(measurer).layoutParagraph(
      [
        {
          text: source,
          style: DEFAULT_STYLE,
          sourceRef: { nodePath: [0] },
          sourceText: source,
        },
      ],
      100,
      0,
    );
    const runs = lines
      .flatMap((line) => line.runs)
      .filter((run): run is TextRun => run.type === 'text-run');

    expect(lines.length).toBeGreaterThan(1);
    for (const run of runs) {
      expect(run.sourceTextOffset).toBe(source.indexOf(run.text.replace(/-$/, '')));
    }
  });

  it('uses the full width after an indented optimal first line', () => {
    const style = { ...DEFAULT_STYLE, textIndent: 40 };
    const lines = createKnuthPlassLayouter(measurer).layoutParagraph(
      [{ text: 'aa aa aa aa aa aa aa aa aa', style }],
      100,
      0,
    );

    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.runs[0]?.bounds.x).toBe(40);
    const laterWidths = lines
      .slice(1)
      .map((line) =>
        line.runs.reduce((right, run) => Math.max(right, run.bounds.x + run.bounds.width), 0),
      );
    expect(laterWidths.some((width) => width > 60)).toBe(true);
  });

  it('honors pre-wrap and nowrap semantics in optimal mode', () => {
    const layouter = createKnuthPlassLayouter(measurer);
    const preWrap = layouter.layoutParagraph(
      [{ text: 'a   b', style: { ...DEFAULT_STYLE, whiteSpace: 'pre-wrap' } }],
      200,
      0,
    );
    const nowrap = layouter.layoutParagraph(
      [{ text: 'alpha beta gamma', style: { ...DEFAULT_STYLE, whiteSpace: 'nowrap' } }],
      30,
      0,
    );

    expect(
      preWrap
        .flatMap((line) => line.runs)
        .map((run) => ('text' in run ? run.text : ''))
        .join(''),
    ).toBe('a   b');
    expect(nowrap).toHaveLength(1);
  });

  it('includes inline margins in the optimal line-width budget', () => {
    const lines = createKnuthPlassLayouter(measurer).layoutParagraph(
      [
        {
          text: 'aa aa',
          style: DEFAULT_STYLE,
          inlineMarginLeft: 20,
          inlineMarginRight: 20,
        },
      ],
      50,
      0,
    );

    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) {
      const right = line.runs.reduce((max, run) => {
        const margin = run.type === 'text-run' ? (run.inlineMarginRight ?? 0) : 0;
        return Math.max(max, run.bounds.x + run.bounds.width + margin);
      }, 0);
      expect(right).toBeLessThanOrEqual(50);
    }
  });

  it('preserves source mapping when Unicode text-transform would change length', () => {
    const node = {
      type: 'text' as const,
      content: 'straße',
      sourceRef: { nodePath: [0] },
    };
    const styled = resolveStyles([node], { ...DEFAULT_STYLE, textTransform: 'uppercase' });
    const segments = flattenInlineContent(styled);
    const segment = segments[0];

    expect(segment && !isInlineAtom(segment) ? segment.text : undefined).toBe('straße');
  });
});
