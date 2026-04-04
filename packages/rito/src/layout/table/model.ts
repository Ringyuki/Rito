import type { StyledNode } from '../../style/core/types';
import { isCellNode } from './shared';

interface TableModel {
  readonly rows: readonly StyledNode[];
  readonly colCount: number;
  readonly occupied: readonly (readonly boolean[])[];
}

export function buildTableModel(table: StyledNode): TableModel | undefined {
  const rows = collectRows(table);
  const colCount = rows.length > 0 ? computeColumnCount(rows) : 0;
  if (colCount === 0) return undefined;

  const occupied = rows.map(() => Array.from<boolean>({ length: colCount }).fill(false));
  applyRowspanOccupancy(rows, occupied, colCount);
  return { rows, colCount, occupied };
}

function collectRows(table: StyledNode): StyledNode[] {
  const rows: StyledNode[] = [];
  for (const child of table.children) {
    if (child.type !== 'block') continue;
    if (child.tag === 'tr') {
      rows.push(child);
      continue;
    }
    if (child.tag !== 'thead' && child.tag !== 'tbody' && child.tag !== 'tfoot') continue;

    for (const grandchild of child.children) {
      if (grandchild.type === 'block' && grandchild.tag === 'tr') {
        rows.push(grandchild);
      }
    }
  }
  return rows;
}

function computeColumnCount(rows: readonly StyledNode[]): number {
  let max = 0;
  for (const row of rows) {
    let count = 0;
    for (const cell of row.children) {
      if (!isCellNode(cell)) continue;
      count += cell.colspan ?? 1;
    }
    if (count > max) max = count;
  }
  return max;
}

function applyRowspanOccupancy(
  rows: readonly StyledNode[],
  occupied: boolean[][],
  colCount: number,
): void {
  for (let rowIndex = 0; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    if (!row) continue;

    const cells = row.children.filter(isCellNode);
    let col = 0;
    let cellIndex = 0;
    while (col < colCount && cellIndex < cells.length) {
      while (col < colCount && occupied[rowIndex]?.[col]) col++;
      if (col >= colCount) break;

      const cell = cells[cellIndex];
      cellIndex++;
      if (!cell) continue;

      const colSpan = cell.colspan ?? 1;
      const rowSpan = cell.rowspan ?? 1;
      markOccupiedRows(occupied, rowIndex, col, rowSpan, colSpan, colCount);
      col += colSpan;
    }
  }
}

function markOccupiedRows(
  occupied: boolean[][],
  rowIndex: number,
  col: number,
  rowSpan: number,
  colSpan: number,
  colCount: number,
): void {
  if (rowSpan <= 1) return;
  for (let rowOffset = 1; rowOffset < rowSpan; rowOffset++) {
    const occupiedRow = occupied[rowIndex + rowOffset];
    if (!occupiedRow) continue;
    for (let colOffset = 0; colOffset < colSpan && col + colOffset < colCount; colOffset++) {
      occupiedRow[col + colOffset] = true;
    }
  }
}
