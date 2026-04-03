import { describe, it, expect } from 'vitest';
import { createListContext, addListMarker } from '../../src/layout/list-layout';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import { LIST_STYLE_TYPES } from '../../src/style/types';
import type { ListStyleType, StyledNode } from '../../src/style/types';
import type { LayoutBlock, LineBox } from '../../src/layout/types';

function makeNode(tag: string, listStyleType: ListStyleType = LIST_STYLE_TYPES.Disc): StyledNode {
  return { type: 'block', tag, style: { ...DEFAULT_STYLE, listStyleType }, children: [] };
}

function makeBlock(lineText = 'test'): LayoutBlock {
  const run = {
    type: 'text-run' as const,
    text: lineText,
    bounds: { x: 0, y: 0, width: 50, height: 20 },
    style: DEFAULT_STYLE,
  };
  const line: LineBox = {
    type: 'line-box',
    bounds: { x: 0, y: 0, width: 100, height: 20 },
    runs: [run],
  };
  return { type: 'layout-block', bounds: { x: 0, y: 0, width: 100, height: 20 }, children: [line] };
}

describe('createListContext', () => {
  it('returns context for ul', () => {
    const ctx = createListContext(makeNode('ul'));
    expect(ctx).toEqual({ listStyleType: 'disc', counter: 0 });
  });

  it('returns context for ol', () => {
    const ctx = createListContext(makeNode('ol', LIST_STYLE_TYPES.Decimal));
    expect(ctx).toEqual({ listStyleType: 'decimal', counter: 0 });
  });

  it('returns undefined for non-list tags', () => {
    expect(createListContext(makeNode('div'))).toBeUndefined();
    expect(createListContext(makeNode('p'))).toBeUndefined();
  });
});

describe('addListMarker', () => {
  it('adds bullet marker for disc list', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.Disc, counter: 0 };
    const block = makeBlock();
    const result = addListMarker(block, makeNode('li'), ctx);
    const firstLine = result.children[0] as LineBox;
    expect(firstLine.runs.length).toBe(2);
    expect(firstLine.runs[0]?.text).toBe('\u2022');
    expect(ctx.counter).toBe(1);
  });

  it('adds decimal marker for ordered list', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.Decimal, counter: 0 };
    addListMarker(makeBlock(), makeNode('li'), ctx);
    expect(ctx.counter).toBe(1);
    const result = addListMarker(makeBlock(), makeNode('li'), ctx);
    const firstLine = result.children[0] as LineBox;
    expect(firstLine.runs[0]?.text).toBe('2.');
  });

  it('returns block unchanged for non-li tag', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.Disc, counter: 0 };
    const block = makeBlock();
    expect(addListMarker(block, makeNode('p'), ctx)).toBe(block);
  });

  it('returns block unchanged for list-style-type none', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.None, counter: 0 };
    const block = makeBlock();
    expect(addListMarker(block, makeNode('li'), ctx)).toBe(block);
  });

  it('returns block unchanged without list context', () => {
    const block = makeBlock();
    expect(addListMarker(block, makeNode('li'), undefined)).toBe(block);
  });
});
