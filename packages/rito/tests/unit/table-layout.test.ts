import { describe, it, expect } from 'vitest';
import { layoutTable } from '../../src/layout/table';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { StyledNode } from '../../src/style/types';
import type { ParagraphLayouter } from '../../src/layout/text/paragraph-layouter';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { createGreedyLayouter } from '../../src/layout/line-breaker/greedy';

function makeCell(text: string, colspan?: number, rowspan?: number): StyledNode {
  const child: StyledNode = { type: 'text', content: text, style: DEFAULT_STYLE, children: [] };
  const cell: StyledNode = {
    type: 'block',
    tag: 'td',
    style: DEFAULT_STYLE,
    children: [child],
    ...(colspan ? { colspan } : {}),
    ...(rowspan ? { rowspan } : {}),
  };
  return cell;
}

function makeRow(cells: StyledNode[]): StyledNode {
  return { type: 'block', tag: 'tr', style: DEFAULT_STYLE, children: cells };
}

function makeTable(rows: StyledNode[]): StyledNode {
  return { type: 'block', tag: 'table', style: DEFAULT_STYLE, children: rows };
}

function createLayouter(): ParagraphLayouter {
  return createGreedyLayouter(createMockTextMeasurer());
}

/** Safely get the width of a child block at a given index. */
function childWidth(
  parent: { readonly children: readonly { bounds: { width: number } }[] },
  index: number,
): number {
  const child = parent.children[index];
  expect(child).toBeDefined();
  return child?.bounds.width ?? 0;
}

describe('layoutTable', () => {
  it('returns empty block for table with no rows', () => {
    const table = makeTable([]);
    const result = layoutTable(table, 400, 0, createLayouter());
    expect(result.bounds.height).toBe(0);
    expect(result.children).toHaveLength(0);
  });

  it('lays out a simple 2x2 table', () => {
    const table = makeTable([
      makeRow([makeCell('A'), makeCell('B')]),
      makeRow([makeCell('C'), makeCell('D')]),
    ]);
    const result = layoutTable(table, 400, 0, createLayouter());
    expect(result.children).toHaveLength(2);
    expect(result.bounds.width).toBe(400);
    expect(result.bounds.height).toBeGreaterThan(0);
  });

  it('handles colspan', () => {
    const table = makeTable([
      makeRow([makeCell('Wide', 2)]),
      makeRow([makeCell('A'), makeCell('B')]),
    ]);
    const result = layoutTable(table, 400, 0, createLayouter());
    expect(result.children).toHaveLength(2);
    // First row should have one cell spanning full width
    const firstRow = result.children[0];
    expect(firstRow?.type).toBe('layout-block');
  });

  it('handles rowspan', () => {
    const table = makeTable([
      makeRow([makeCell('Tall', undefined, 2), makeCell('B')]),
      makeRow([makeCell('D')]),
    ]);
    const result = layoutTable(table, 400, 0, createLayouter());
    expect(result.children).toHaveLength(2);
  });

  it('unwraps tbody wrapper', () => {
    const tbody: StyledNode = {
      type: 'block',
      tag: 'tbody',
      style: DEFAULT_STYLE,
      children: [makeRow([makeCell('A'), makeCell('B')])],
    };
    const table = makeTable([tbody]);
    const result = layoutTable(table, 400, 0, createLayouter());
    expect(result.children).toHaveLength(1);
    expect(result.bounds.height).toBeGreaterThan(0);
  });

  it('positions at given y offset', () => {
    const table = makeTable([makeRow([makeCell('A')])]);
    const result = layoutTable(table, 400, 100, createLayouter());
    expect(result.bounds.y).toBe(100);
  });

  describe('auto column widths', () => {
    // Mock measurer: charWidth = fontSize(16) * factor(0.6) = 9.6 px/char
    // CELL_PADDING = 4, so each cell adds 8px total padding.

    it('gives wider column to longer content', () => {
      // Col 0: "LongerText" = 10 chars, Col 1: "Hi" = 2 chars
      const table = makeTable([makeRow([makeCell('LongerText'), makeCell('Hi')])]);
      const result = layoutTable(table, 400, 0, createLayouter());
      const row = result.children[0];
      expect(row).toBeDefined();
      if (!row || row.type !== 'layout-block') return;

      expect(childWidth(row, 0)).toBeGreaterThan(childWidth(row, 1));
    });

    it('distributes proportionally to content differences', () => {
      const table = makeTable([makeRow([makeCell('ABCDEFGHIJ'), makeCell('AB')])]);
      const result = layoutTable(table, 400, 0, createLayouter());
      const row = result.children[0];
      expect(row).toBeDefined();
      if (!row || row.type !== 'layout-block') return;

      // Total width should be 400
      expect(childWidth(row, 0) + childWidth(row, 1)).toBeCloseTo(400, 1);
    });

    it('uses widest cell per column across multiple rows', () => {
      const table = makeTable([
        makeRow([makeCell('AB'), makeCell('XY')]),
        makeRow([makeCell('ABCDEF'), makeCell('Z')]),
      ]);
      const result = layoutTable(table, 400, 0, createLayouter());
      const row0 = result.children[0];
      expect(row0).toBeDefined();
      if (!row0 || row0.type !== 'layout-block') return;

      // Column 0 has longer content (ABCDEF), so should be wider
      expect(childWidth(row0, 0)).toBeGreaterThan(childWidth(row0, 1));
    });

    it('respects minimum width for cells with multi-word content', () => {
      const table = makeTable([makeRow([makeCell('Hello World'), makeCell('A')])]);
      const result = layoutTable(table, 400, 0, createLayouter());
      const row = result.children[0];
      expect(row).toBeDefined();
      if (!row || row.type !== 'layout-block') return;

      // Column 0 should get significantly more space
      expect(childWidth(row, 0)).toBeGreaterThan(childWidth(row, 1));
      // Min width for col1 is 17.6; it should be at least that
      expect(childWidth(row, 1)).toBeGreaterThanOrEqual(17.6);
    });

    it('handles three columns with varied content', () => {
      const table = makeTable([
        makeRow([makeCell('Short'), makeCell('MediumLength'), makeCell('X')]),
      ]);
      const result = layoutTable(table, 600, 0, createLayouter());
      const row = result.children[0];
      expect(row).toBeDefined();
      if (!row || row.type !== 'layout-block') return;

      const w0 = childWidth(row, 0);
      const w1 = childWidth(row, 1);
      const w2 = childWidth(row, 2);
      // MediumLength (12 chars) > Short (5 chars) > X (1 char)
      expect(w1).toBeGreaterThan(w0);
      expect(w0).toBeGreaterThan(w2);
      expect(w0 + w1 + w2).toBeCloseTo(600, 1);
    });

    it('overflows when minimum widths exceed table width', () => {
      const longWord = 'A'.repeat(30);
      const table = makeTable([makeRow([makeCell(longWord), makeCell(longWord)])]);
      const result = layoutTable(table, 400, 0, createLayouter());
      const row = result.children[0];
      expect(row).toBeDefined();
      if (!row || row.type !== 'layout-block') return;

      const w0 = childWidth(row, 0);
      const w1 = childWidth(row, 1);
      // Both columns should have equal minimum widths (same content)
      expect(w0).toBeCloseTo(w1, 1);
      // Total exceeds table width
      expect(w0 + w1).toBeGreaterThan(400);
    });

    it('handles empty cells gracefully', () => {
      const emptyCell: StyledNode = {
        type: 'block',
        tag: 'td',
        style: DEFAULT_STYLE,
        children: [],
      };
      const table = makeTable([makeRow([emptyCell, makeCell('Content')])]);
      const result = layoutTable(table, 400, 0, createLayouter());
      expect(result.children).toHaveLength(1);
      expect(result.bounds.height).toBeGreaterThan(0);
    });
  });
});
