import { describe, expect, it } from 'vitest';
import { layoutBlocks } from '../../src/layout/block';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { parseCssRules } from '../../src/style/css/rule-parser';
import type { DocumentNode } from '../../src/parser/xhtml/types';
import type { HorizontalRule, LayoutBlock } from '../../src/layout/core/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const CONTENT_WIDTH = 300;

function findHr(blocks: readonly LayoutBlock[]): HorizontalRule | undefined {
  for (const block of blocks) {
    for (const child of block.children) {
      if (child.type === 'hr') return child;
    }
  }
  return undefined;
}

describe('<hr> layout', () => {
  it('uses default 1px solid with element color when no border-top', () => {
    const hr: DocumentNode = {
      type: NODE_TYPES.Block,
      tag: 'hr',
      children: [],
    };
    const styled = resolveStyles([hr]);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const rule = findHr(blocks);
    expect(rule).toBeDefined();
    expect(rule?.bounds.height).toBe(1);
    expect(rule?.borderStyle).toBeUndefined(); // solid is the default — not stored
  });

  it('honors border-top width, color, and dotted style', () => {
    const rules = parseCssRules(
      'hr { border-top: 2px dotted red; border-bottom: none; border-left: none; border-right: none }',
      16,
    );
    const hr: DocumentNode = {
      type: NODE_TYPES.Block,
      tag: 'hr',
      children: [],
    };
    const styled = resolveStyles([hr], undefined, rules);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const rule = findHr(blocks);
    expect(rule).toBeDefined();
    expect(rule?.bounds.height).toBe(2);
    expect(rule?.color).toBe('red');
    expect(rule?.borderStyle).toBe('dotted');
  });

  it('honors dashed style on border-top', () => {
    const rules = parseCssRules('hr { border-top: 3px dashed #123456 }', 16);
    const hr: DocumentNode = { type: NODE_TYPES.Block, tag: 'hr', children: [] };
    const styled = resolveStyles([hr], undefined, rules);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const rule = findHr(blocks);
    expect(rule?.bounds.height).toBe(3);
    expect(rule?.borderStyle).toBe('dashed');
    expect(rule?.color).toBe('#123456');
  });

  it('advances state.y by the full border-top height', () => {
    const rules = parseCssRules('hr { border-top: 5px solid black }', 16);
    const doc: DocumentNode[] = [
      { type: NODE_TYPES.Block, tag: 'hr', children: [] },
      { type: NODE_TYPES.Block, tag: 'p', children: [{ type: NODE_TYPES.Text, content: 'x' }] },
    ];
    const styled = resolveStyles(doc, undefined, rules);
    const blocks = layoutBlocks(styled, CONTENT_WIDTH, layouter);
    const hrBlock = blocks[0];
    const pBlock = blocks[1];
    expect(hrBlock?.bounds.height).toBe(5);
    // Next block should start at or below the HR's 5px height (plus any margin)
    expect(pBlock?.bounds.y).toBeGreaterThanOrEqual(5);
  });
});
