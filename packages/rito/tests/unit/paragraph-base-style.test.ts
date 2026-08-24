import { describe, expect, it } from 'vitest';
import { layoutBlocks } from '../../src/reference/ts-core/layout/block';
import { createGreedyLayouter } from '../../src/reference/ts-core/layout/line-breaker/greedy';
import type { DocumentNode } from '../../src/reference/ts-core/parser/xhtml/types';
import { NODE_TYPES } from '../../src/reference/ts-core/parser/xhtml/types';
import { resolveStyles } from '../../src/reference/ts-core/style/cascade/resolver';
import { parseCssRules } from '../../src/reference/ts-core/style/css/rule-parser';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';

describe('paragraph base style', () => {
  it('uses the paragraph line-height when laying out inherited text nodes', () => {
    const rules = parseCssRules(
      `
        p { line-height: 1.3em; margin: 0; }
        .illu p { line-height: 1.2em; text-indent: 0; }
        .font07 { font-size: 0.7em; }
      `,
      16,
    );

    const nodes: DocumentNode[] = [
      {
        type: NODE_TYPES.Block,
        tag: 'div',
        attributes: { class: 'illu' },
        children: [
          {
            type: NODE_TYPES.Block,
            tag: 'p',
            attributes: { class: 'font07' },
            children: [{ type: NODE_TYPES.Text, content: '在本作中登场的说明文字' }],
          },
        ],
      },
    ];

    const styled = resolveStyles(nodes, undefined, rules);
    const layouter = createGreedyLayouter(createMockTextMeasurer(0.6));
    const blocks = layoutBlocks(styled, 200, layouter);

    const paragraph = blocks[0];
    expect(paragraph?.children[0]?.type).toBe('line-box');
    const line = paragraph?.children[0];
    if (!line || line.type !== 'line-box') return;

    expect(line.bounds.height).toBeCloseTo(13.44);
    const firstRun = line.runs[0];
    expect(firstRun?.type).toBe('text-run');
    if (!firstRun || firstRun.type !== 'text-run') return;
    expect(firstRun.lineHeightPx).toBeCloseTo(13.44);
  });
});
