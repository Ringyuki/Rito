import { describe, it, expect } from 'vitest';
import {
  extractBorders,
  computeChildrenHeight,
  withPageBreaks,
  applyPageBreakFlags,
} from '../../src/layout/block/helpers';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { LayoutBlock, LineBox } from '../../src/layout/core/types';

describe('extractBorders', () => {
  it('returns undefined when all borders are none', () => {
    expect(extractBorders(DEFAULT_STYLE)).toBeUndefined();
  });

  it('extracts solid border', () => {
    const style = {
      ...DEFAULT_STYLE,
      borderTop: { width: 1, color: '#000', style: 'solid' as const },
    };
    const borders = extractBorders(style);
    expect(borders?.top).toEqual({ width: 1, color: '#000', style: 'solid' });
  });

  it('extracts dashed border', () => {
    const style = {
      ...DEFAULT_STYLE,
      borderBottom: { width: 2, color: 'red', style: 'dashed' as const },
    };
    const borders = extractBorders(style);
    expect(borders?.bottom).toEqual({ width: 2, color: 'red', style: 'dashed' });
  });

  it('ignores zero-width borders', () => {
    const style = {
      ...DEFAULT_STYLE,
      borderTop: { width: 0, color: '#000', style: 'solid' as const },
    };
    expect(extractBorders(style)).toBeUndefined();
  });
});

describe('computeChildrenHeight', () => {
  it('returns 0 for empty array', () => {
    expect(computeChildrenHeight([])).toBe(0);
  });

  it('computes height from last line box', () => {
    const lines: LineBox[] = [
      { type: 'line-box', bounds: { x: 0, y: 0, width: 100, height: 20 }, runs: [] },
      { type: 'line-box', bounds: { x: 0, y: 20, width: 100, height: 20 }, runs: [] },
    ];
    expect(computeChildrenHeight(lines)).toBe(40);
  });
});

describe('withPageBreaks', () => {
  const block: LayoutBlock = {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: 100, height: 50 },
    children: [],
  };

  it('returns same block if no page breaks', () => {
    expect(withPageBreaks(block, DEFAULT_STYLE)).toBe(block);
  });

  it('adds pageBreakBefore', () => {
    const style = { ...DEFAULT_STYLE, pageBreakBefore: 'always' as const };
    const result = withPageBreaks(block, style);
    expect(result.pageBreakBefore).toBe(true);
  });

  it('adds pageBreakAfter', () => {
    const style = { ...DEFAULT_STYLE, pageBreakAfter: 'always' as const };
    const result = withPageBreaks(block, style);
    expect(result.pageBreakAfter).toBe(true);
  });
});

describe('applyPageBreakFlags', () => {
  it('does nothing for empty blocks', () => {
    applyPageBreakFlags([], { ...DEFAULT_STYLE, pageBreakBefore: 'always' as const });
  });

  it('sets pageBreakBefore on first block', () => {
    const blocks: LayoutBlock[] = [
      { type: 'layout-block', bounds: { x: 0, y: 0, width: 100, height: 50 }, children: [] },
    ];
    applyPageBreakFlags(blocks, { ...DEFAULT_STYLE, pageBreakBefore: 'always' as const });
    expect(blocks[0]?.pageBreakBefore).toBe(true);
  });

  it('sets pageBreakAfter on last block', () => {
    const blocks: LayoutBlock[] = [
      { type: 'layout-block', bounds: { x: 0, y: 0, width: 100, height: 50 }, children: [] },
      { type: 'layout-block', bounds: { x: 0, y: 50, width: 100, height: 50 }, children: [] },
    ];
    applyPageBreakFlags(blocks, { ...DEFAULT_STYLE, pageBreakAfter: 'always' as const });
    expect(blocks[1]?.pageBreakAfter).toBe(true);
    expect(blocks[0]?.pageBreakAfter).toBeUndefined();
  });
});
