import { describe, it, expect } from 'vitest';
import { layoutTable } from '../../src/layout/table-layout';
import { DEFAULT_STYLE } from '../../src/style/defaults';
import type { StyledNode } from '../../src/style/types';
import type { ParagraphLayouter } from '../../src/layout/paragraph-layouter';
import { createMockTextMeasurer } from '../helpers/mock-text-measurer';
import { createGreedyLayouter } from '../../src/layout/greedy-line-breaker';

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
});
