/** The grid a leaf is drawn with: fine enough for its bend to look smooth. */
export const COLUMNS = 64;
export const ROWS = 48;

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
