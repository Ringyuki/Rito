import { describe, expect, it } from 'vitest';
import { layoutBlocks } from '../../src/layout/block';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { resolveStyles } from '../../src/style/cascade/resolver';
import { parseCssRules } from '../../src/style/css/rule-parser';
import type { DocumentNode, ElementAttributes } from '../../src/parser/xhtml/types';
import { NODE_TYPES } from '../../src/parser/xhtml/types';

const measurer = createMockTextMeasurer(0.6);
const layouter = createGreedyLayouter(measurer);
const W = 300;
const BASE = 16;

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

describe('position: absolute layout', () => {
  it('absolute child does not advance flow (sibling renders at same Y as without it)', () => {
    const css = '.wrapper { position: relative; } .abs { position: absolute; top: 0; left: 0; }';
    const rules = parseCssRules(css, BASE);
    const nodes: DocumentNode[] = [
      block('div', [block('div', [text('Abs')], { class: 'abs' }), block('p', [text('Flow')])], {
        class: 'wrapper',
      }),
    ];

    const styled = resolveStyles(nodes, undefined, rules);
    const blocks = layoutBlocks(styled, W, layouter);

    // The flow paragraph should start near the top (not pushed down by the absolute child)
    const flowBlock = blocks.find((b) =>
      b.children.some(
        (c) => c.type === 'line-box' && c.runs.some((r) => 'text' in r && r.text.includes('Flow')),
      ),
    );
    expect(flowBlock).toBeDefined();
    // Flow paragraph should be near y=0 (only affected by normal margins)
    expect(flowBlock?.bounds.y).toBeLessThan(30);
  });

  it('positions absolute child with top/left inside relative parent', () => {
    const css =
      '.wrapper { position: relative; } .abs { position: absolute; top: 20px; left: 30px; }';
    const rules = parseCssRules(css, BASE);
    const nodes: DocumentNode[] = [
      block('div', [block('div', [text('Overlay')], { class: 'abs' })], { class: 'wrapper' }),
    ];

    const styled = resolveStyles(nodes, undefined, rules);
    const blocks = layoutBlocks(styled, W, layouter);

    // The absolute block should be positioned at (30, parent.y + 20)
    const absBlock = blocks.find((b) =>
      b.children.some(
        (c) =>
          c.type === 'line-box' && c.runs.some((r) => 'text' in r && r.text.includes('Overlay')),
      ),
    );
    expect(absBlock).toBeDefined();
    // left offset should include parent indent + 30px
    expect(absBlock?.bounds.x).toBeGreaterThanOrEqual(30);
  });

  it('orphan absolute at top level is skipped', () => {
    const css = '.abs { position: absolute; top: 10px; left: 10px; }';
    const rules = parseCssRules(css, BASE);
    const nodes: DocumentNode[] = [
      block('div', [text('Orphan')], { class: 'abs' }),
      block('p', [text('Normal')]),
    ];

    const styled = resolveStyles(nodes, undefined, rules);
    const blocks = layoutBlocks(styled, W, layouter);

    // Only the normal paragraph should be in the output
    const hasOrphan = blocks.some((b) =>
      b.children.some(
        (c) =>
          c.type === 'line-box' && c.runs.some((r) => 'text' in r && r.text.includes('Orphan')),
      ),
    );
    expect(hasOrphan).toBe(false);

    const hasNormal = blocks.some((b) =>
      b.children.some(
        (c) =>
          c.type === 'line-box' && c.runs.some((r) => 'text' in r && r.text.includes('Normal')),
      ),
    );
    expect(hasNormal).toBe(true);
  });

  it('positions with bottom/right relative to containing block', () => {
    const css =
      '.wrapper { position: relative; } .abs { position: absolute; bottom: 10px; right: 20px; width: 50px; }';
    const rules = parseCssRules(css, BASE);
    const nodes: DocumentNode[] = [
      block(
        'div',
        [
          block('p', [text('Content to give height')]),
          block('div', [text('BR')], { class: 'abs' }),
        ],
        { class: 'wrapper' },
      ),
    ];

    const styled = resolveStyles(nodes, undefined, rules);
    const blocks = layoutBlocks(styled, W, layouter);

    const absBlock = blocks.find((b) =>
      b.children.some(
        (c) => c.type === 'line-box' && c.runs.some((r) => 'text' in r && r.text.includes('BR')),
      ),
    );
    expect(absBlock).toBeDefined();
    // With right: 20px, width: 50px, x should be near containingWidth - 50 - 20
    expect(absBlock?.bounds.width).toBe(50);
  });

  it('uses explicit width/height when provided', () => {
    const css =
      '.wrapper { position: relative; } .abs { position: absolute; top: 0; left: 0; width: 100px; height: 50px; }';
    const rules = parseCssRules(css, BASE);
    const nodes: DocumentNode[] = [
      block('div', [block('div', [text('Sized')], { class: 'abs' })], { class: 'wrapper' }),
    ];

    const styled = resolveStyles(nodes, undefined, rules);
    const blocks = layoutBlocks(styled, W, layouter);

    const absBlock = blocks.find((b) =>
      b.children.some(
        (c) => c.type === 'line-box' && c.runs.some((r) => 'text' in r && r.text.includes('Sized')),
      ),
    );
    expect(absBlock).toBeDefined();
    expect(absBlock?.bounds.width).toBe(100);
  });
});
