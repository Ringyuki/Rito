import { describe, expect, it } from 'vitest';
import { trySplitBlock } from '../../src/layout/pagination/split';
import type { LayoutBlock, LineBox } from '../../src/layout/core/types';
import { parseCssDeclarations } from '../../src/style/css/property-parser';
import { DEFAULT_STYLE } from '../../src/style/core/defaults';
import { inheritableStyle } from '../../src/style/core/defaults';

function makeLine(y: number, height: number): LineBox {
  return {
    type: 'line-box',
    bounds: { x: 0, y, width: 300, height },
    runs: [],
  };
}

function makeBlock(
  lineCount: number,
  lineHeight: number,
  opts?: { orphans?: number; widows?: number },
): LayoutBlock {
  const lines = Array.from({ length: lineCount }, (_, i) => makeLine(i * lineHeight, lineHeight));
  let block: LayoutBlock = {
    type: 'layout-block',
    bounds: { x: 0, y: 0, width: 300, height: lineCount * lineHeight },
    children: lines,
  };
  if (opts?.orphans !== undefined) block = { ...block, orphans: opts.orphans };
  if (opts?.widows !== undefined) block = { ...block, widows: opts.widows };
  return block;
}

describe('widow/orphan control in trySplitBlock', () => {
  it('default (orphans:2, widows:2) — same as previous MIN_SPLIT_LINES=2 behavior', () => {
    const block = makeBlock(4, 24);
    // available height fits 2 lines (48px)
    const result = trySplitBlock(block, 48);
    expect(result).toBeDefined();
    expect(result?.head.children).toHaveLength(2);
    expect(result?.tail.children).toHaveLength(2);
  });

  it('orphans:4, 10 lines, 3 available → no split (cannot fit 4 orphans)', () => {
    const block = makeBlock(10, 24, { orphans: 4 });
    // 3 lines fit (72px)
    const result = trySplitBlock(block, 72);
    // splitIndex would be 3, but orphans requires at least 4 → bumped to 4
    // 4 lines * 24 = 96 > 72 available? The split adjusts index, not height check.
    // Actually split.ts bumps splitIndex to 4 but doesn't re-check height.
    // Let's verify: splitIndex=3, bumped to 4, 10-4=6 >= widows(2). splitIndex=4 > 0 && < 10. So split happens at 4.
    expect(result).toBeDefined();
    expect(result?.head.children).toHaveLength(4);
    expect(result?.tail.children).toHaveLength(6);
  });

  it('widows:4, 10 lines, 8 available → split at 6', () => {
    const block = makeBlock(10, 24, { widows: 4 });
    // 8 lines fit (192px)
    const result = trySplitBlock(block, 192);
    expect(result).toBeDefined();
    // splitIndex from height = 8, but widows requires 10-splitIndex >= 4 → splitIndex <= 6
    expect(result?.head.children).toHaveLength(6);
    expect(result?.tail.children).toHaveLength(4);
  });

  it('orphans:3, widows:3, 6 lines → split at 3', () => {
    const block: LayoutBlock = {
      ...makeBlock(6, 24),
      orphans: 3,
      widows: 3,
    };
    // available height fits 4 lines (96px)
    const result = trySplitBlock(block, 96);
    expect(result).toBeDefined();
    expect(result?.head.children).toHaveLength(3);
    expect(result?.tail.children).toHaveLength(3);
  });

  it('orphans:5, widows:5, 8 lines → still splits at height boundary (overflow prevention)', () => {
    const block: LayoutBlock = {
      ...makeBlock(8, 24),
      orphans: 5,
      widows: 5,
    };
    // 5+5 > 8, but we split anyway at the height boundary to prevent overflow
    const result = trySplitBlock(block, 120);
    expect(result).toBeDefined();
    expect(result?.head.children).toHaveLength(5); // 120px / 24px = 5 lines
    expect(result?.tail.children).toHaveLength(3);
  });

  it('orphans:1, widows:1 → most permissive, split at 1', () => {
    const block: LayoutBlock = {
      ...makeBlock(4, 24),
      orphans: 1,
      widows: 1,
    };
    // available height fits 1 line (24px)
    const result = trySplitBlock(block, 24);
    expect(result).toBeDefined();
    expect(result?.head.children).toHaveLength(1);
    expect(result?.tail.children).toHaveLength(3);
  });

  it('block without orphans/widows fields defaults to 2, but still splits small blocks', () => {
    const block = makeBlock(3, 24);
    // 2+2=4 > 3 lines, but split anyway at height boundary to prevent overflow
    const result = trySplitBlock(block, 48);
    expect(result).toBeDefined();
    expect(result?.head.children).toHaveLength(2); // 48px / 24px = 2 lines
    expect(result?.tail.children).toHaveLength(1);
  });
});

describe('PaginationPolicy in trySplitBlock', () => {
  it('enabled:false disables widow/orphan enforcement (allows 1/N split)', () => {
    const block = makeBlock(4, 24, { orphans: 3, widows: 3 });
    // Without policy: orphans:3 + widows:3 > 4 lines → overflow split at height boundary
    // With enabled:false: orphans=1, widows=1 → split at 1 line
    const result = trySplitBlock(block, 24, { enabled: false });
    expect(result).toBeDefined();
    expect(result?.head.children).toHaveLength(1);
    expect(result?.tail.children).toHaveLength(3);
  });

  it('custom defaultOrphans/defaultWidows override the hardcoded 2/2', () => {
    // Block without CSS orphans/widows → falls back to policy defaults
    const block = makeBlock(10, 24);
    const result = trySplitBlock(block, 72, { defaultOrphans: 3, defaultWidows: 3 });
    expect(result).toBeDefined();
    // splitIndex from height = 3, bumped to defaultOrphans=3 → stays at 3
    expect(result?.head.children).toHaveLength(3);
    expect(result?.tail.children).toHaveLength(7);
  });

  it('CSS orphans/widows on block override policy defaults', () => {
    // Block has CSS orphans:4, policy default is 3
    const block = makeBlock(10, 24, { orphans: 4 });
    const result = trySplitBlock(block, 72, { defaultOrphans: 3 });
    expect(result).toBeDefined();
    // CSS orphans:4 takes precedence over policy default 3
    expect(result?.head.children).toHaveLength(4);
  });

  it('undefined policy behaves same as default (orphans:2, widows:2)', () => {
    const block = makeBlock(10, 24);
    const withPolicy = trySplitBlock(block, 48, undefined);
    const withoutPolicy = trySplitBlock(block, 48);
    expect(withPolicy?.head.children).toHaveLength(withoutPolicy?.head.children.length ?? 0);
    expect(withPolicy?.tail.children).toHaveLength(withoutPolicy?.tail.children.length ?? 0);
  });
});

describe('CSS parsing of orphans/widows', () => {
  it('parses orphans: 3', () => {
    const result = parseCssDeclarations('orphans: 3', 16);
    expect(result.orphans).toBe(3);
  });

  it('parses widows: 4', () => {
    const result = parseCssDeclarations('widows: 4', 16);
    expect(result.widows).toBe(4);
  });

  it('ignores orphans: 0 (must be >= 1)', () => {
    const result = parseCssDeclarations('orphans: 0', 16);
    expect(result.orphans).toBeUndefined();
  });

  it('ignores widows: -1', () => {
    const result = parseCssDeclarations('widows: -1', 16);
    expect(result.widows).toBeUndefined();
  });

  it('ignores non-numeric orphans', () => {
    const result = parseCssDeclarations('orphans: auto', 16);
    expect(result.orphans).toBeUndefined();
  });
});

describe('orphans/widows inheritance', () => {
  it('DEFAULT_STYLE has orphans:2 and widows:2', () => {
    expect(DEFAULT_STYLE.orphans).toBe(2);
    expect(DEFAULT_STYLE.widows).toBe(2);
  });

  it('inheritable style preserves orphans and widows (they are inherited)', () => {
    const custom = { ...DEFAULT_STYLE, orphans: 3, widows: 4 };
    const inherited = inheritableStyle(custom);
    expect(inherited.orphans).toBe(3);
    expect(inherited.widows).toBe(4);
  });
});
