import { describe, it, expect } from 'vitest';
import { createListContext, addListMarker } from '../../src/layout/block/list';
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

  it('adds lower-alpha marker', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.LowerAlpha, counter: 0 };
    const cases: Array<[number, string]> = [
      [1, 'a.'],
      [2, 'b.'],
      [4, 'd.'],
      [9, 'i.'],
      [14, 'n.'],
      [26, 'z.'],
      [27, 'aa.'],
      [28, 'ab.'],
      [100, 'cv.'],
    ];
    for (const [target, expected] of cases) {
      while (ctx.counter < target - 1) {
        addListMarker(makeBlock(), makeNode('li'), ctx);
      }
      const result = addListMarker(makeBlock(), makeNode('li'), ctx);
      const firstLine = result.children[0] as LineBox;
      expect(firstLine.runs[0]?.text).toBe(expected);
    }
  });

  it('adds upper-alpha marker', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.UpperAlpha, counter: 0 };
    const cases: Array<[number, string]> = [
      [1, 'A.'],
      [4, 'D.'],
      [26, 'Z.'],
      [27, 'AA.'],
      [100, 'CV.'],
    ];
    for (const [target, expected] of cases) {
      while (ctx.counter < target - 1) {
        addListMarker(makeBlock(), makeNode('li'), ctx);
      }
      const result = addListMarker(makeBlock(), makeNode('li'), ctx);
      const firstLine = result.children[0] as LineBox;
      expect(firstLine.runs[0]?.text).toBe(expected);
    }
  });

  it('adds lower-roman marker', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.LowerRoman, counter: 0 };
    const cases: Array<[number, string]> = [
      [1, 'i.'],
      [2, 'ii.'],
      [3, 'iii.'],
      [4, 'iv.'],
      [5, 'v.'],
      [9, 'ix.'],
      [10, 'x.'],
      [14, 'xiv.'],
      [26, 'xxvi.'],
      [27, 'xxvii.'],
      [100, 'c.'],
    ];
    for (const [target, expected] of cases) {
      while (ctx.counter < target - 1) {
        addListMarker(makeBlock(), makeNode('li'), ctx);
      }
      const result = addListMarker(makeBlock(), makeNode('li'), ctx);
      const firstLine = result.children[0] as LineBox;
      expect(firstLine.runs[0]?.text).toBe(expected);
    }
  });

  it('adds upper-roman marker', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.UpperRoman, counter: 0 };
    const cases: Array<[number, string]> = [
      [1, 'I.'],
      [4, 'IV.'],
      [9, 'IX.'],
      [14, 'XIV.'],
      [100, 'C.'],
    ];
    for (const [target, expected] of cases) {
      while (ctx.counter < target - 1) {
        addListMarker(makeBlock(), makeNode('li'), ctx);
      }
      const result = addListMarker(makeBlock(), makeNode('li'), ctx);
      const firstLine = result.children[0] as LineBox;
      expect(firstLine.runs[0]?.text).toBe(expected);
    }
  });

  it('adds square marker', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.Square, counter: 0 };
    const result = addListMarker(makeBlock(), makeNode('li'), ctx);
    const firstLine = result.children[0] as LineBox;
    expect(firstLine.runs[0]?.text).toBe('\u25AA');
  });

  it('adds circle marker', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.Circle, counter: 0 };
    const result = addListMarker(makeBlock(), makeNode('li'), ctx);
    const firstLine = result.children[0] as LineBox;
    expect(firstLine.runs[0]?.text).toBe('\u25CB');
  });

  it('returns empty marker for none', () => {
    const ctx = { listStyleType: LIST_STYLE_TYPES.None, counter: 0 };
    const block = makeBlock();
    const result = addListMarker(block, makeNode('li'), ctx);
    // none returns the block unchanged
    expect(result).toBe(block);
  });
});
