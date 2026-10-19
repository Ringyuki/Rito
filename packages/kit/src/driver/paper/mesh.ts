/** How a grid of points over the sheet is told to the GPU. */
export interface SheetGrid {
  /** Where each point is on the sheet: from the spine outward, from the top down. */
  readonly uvs: Float32Array;
  /** The triangles between the points, front faces wound to the left, row by row from the top down. */
  readonly indices: Uint16Array;
  /** The same triangles, row by row from the bottom up. */
  readonly fromBelow: Uint16Array;
}

export function sheetGrid(columns: number, rows: number): SheetGrid {
  const uvs = new Float32Array(columns * rows * 2);
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const at = row * columns + column;
      uvs[at * 2] = column / (columns - 1);
      uvs[at * 2 + 1] = row / (rows - 1);
    }
  }
  const down: number[] = [];
  const up: number[] = [];
  for (let row = 0; row + 1 < rows; row += 1) {
    down.push(...rowOf(row, columns));
    up.push(...rowOf(rows - 2 - row, columns));
  }
  return { uvs, indices: Uint16Array.from(down), fromBelow: Uint16Array.from(up) };
}

/** The triangles between a row of points and the next, from the spine outward. */
function rowOf(row: number, columns: number): number[] {
  const triangles: number[] = [];
  for (let column = 0; column + 1 < columns; column += 1) {
    const at = row * columns + column;
    triangles.push(at, at + columns, at + 1, at + 1, at + columns, at + columns + 1);
  }
  return triangles;
}
