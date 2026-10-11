/** The grid a leaf is drawn with: fine enough for its bend to look smooth. */
export const COLUMNS = 64;
export const ROWS = 48;
/**
 * The grid a page curled over is drawn with. Its roll is tight and may lie
 * at any angle across the page, so the grid is fine both ways: a few CSS
 * pixels a cell on a phone.
 */
const CURLED_COLUMNS = 96;
const CURLED_ROWS = 160;

/** The grid the sheets of a spread are drawn with: one page a spread is curled, two are leaves. */
export function gridFor(spine: number): { readonly columns: number; readonly rows: number } {
  return spine === 0
    ? { columns: CURLED_COLUMNS, rows: CURLED_ROWS }
    : { columns: COLUMNS, rows: ROWS };
}

/** How a grid of points over the sheet is told to the GPU. */
export interface SheetGrid {
  /** Where each point is on the sheet: from the spine outward, from the top down. */
  readonly uvs: Float32Array;
  /** The triangles between the points, front faces wound to the left. */
  readonly indices: Uint16Array;
}

export function sheetGrid(columns: number, rows: number): SheetGrid {
  const uvs = new Float32Array(columns * rows * 2);
  const indices: number[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = row * columns + column;
      uvs[at * 2] = column / (columns - 1);
      uvs[at * 2 + 1] = row / (rows - 1);
      if (column + 1 === columns || row + 1 === rows) continue;
      indices.push(at, at + columns, at + 1, at + 1, at + columns, at + columns + 1);
    }
  }
  return { uvs, indices: Uint16Array.from(indices) };
}
