/**
 * The sheet as it is drawn: a finer surface through the particles, rounded
 * between them, so that its edge and its shading are smooth where the
 * particles alone would show their grid.
 */
export interface SheetMesh {
  readonly columns: number;
  readonly rows: number;
  /** x, y, z of every point, row by row from the spine outward. */
  readonly positions: Float32Array;
  /** The direction each point's patch of paper faces. */
  readonly normals: Float32Array;
  /** Where each point is on the sheet: from the spine outward, from the top down. */
  readonly uvs: Float32Array;
  /** The triangles between the points, front faces wound to the left. */
  readonly indices: Uint16Array;
  /** Lays the surface through the particles where they are now. */
  update(particles: Float32Array): void;
}

/** How many points the surface has for each step between two particles. */
const DETAIL = 3;

export function createSheetMesh(columns: number, rows: number): SheetMesh {
  const fineColumns = (columns - 1) * DETAIL + 1;
  const fineRows = (rows - 1) * DETAIL + 1;
  const count = fineColumns * fineRows;
  const positions = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  // Each row of particles, rounded along its length.
  const along = new Float32Array(fineColumns * rows * 3);
  const { uvs, indices } = layout(fineColumns, fineRows);
  return {
    columns: fineColumns,
    rows: fineRows,
    positions,
    normals,
    uvs,
    indices,
    update(particles): void {
      for (let row = 0; row < rows; row += 1) {
        rounded(particles, row * columns * 3, 3, columns, along, row * fineColumns * 3, 3);
      }
      const stride = fineColumns * 3;
      for (let column = 0; column < fineColumns; column += 1) {
        rounded(along, column * 3, stride, rows, positions, column * 3, stride);
      }
      facings(positions, fineColumns, fineRows, normals);
    },
  };
}

/**
 * A smooth curve through `count` points of `from` (the first at `start`,
 * each `step` on), written to `to` with `DETAIL` points for every step.
 */
function rounded(
  from: Float32Array,
  start: number,
  step: number,
  count: number,
  to: Float32Array,
  toStart: number,
  toStep: number,
): void {
  const at = (index: number, axis: number): number =>
    from[start + Math.min(count - 1, Math.max(0, index)) * step + axis] ?? 0;
  for (let index = 0; index < count; index += 1) {
    const pieces = index === count - 1 ? 1 : DETAIL;
    for (let piece = 0; piece < pieces; piece += 1) {
      const t = piece / DETAIL;
      const out = toStart + (index * DETAIL + piece) * toStep;
      for (let axis = 0; axis < 3; axis += 1) {
        const before = at(index - 1, axis);
        const here = at(index, axis);
        const next = at(index + 1, axis);
        const after = at(index + 2, axis);
        to[out + axis] =
          0.5 *
          (2 * here +
            (next - before) * t +
            (2 * before - 5 * here + 4 * next - after) * t * t +
            (3 * here - before - 3 * next + after) * t * t * t);
      }
    }
  }
}

function layout(columns: number, rows: number): { uvs: Float32Array; indices: Uint16Array } {
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

/** The direction each point's patch of paper faces: across its neighbours either way. */
function facings(positions: Float32Array, columns: number, rows: number, out: Float32Array): void {
  const at = (column: number, row: number, axis: number): number =>
    positions[(row * columns + column) * 3 + axis] ?? 0;
  for (let row = 0; row < rows; row += 1) {
    const up = Math.max(0, row - 1);
    const down = Math.min(rows - 1, row + 1);
    for (let column = 0; column < columns; column += 1) {
      const left = Math.max(0, column - 1);
      const right = Math.min(columns - 1, column + 1);
      const ax = at(right, row, 0) - at(left, row, 0);
      const ay = at(right, row, 1) - at(left, row, 1);
      const az = at(right, row, 2) - at(left, row, 2);
      const bx = at(column, down, 0) - at(column, up, 0);
      const by = at(column, down, 1) - at(column, up, 1);
      const bz = at(column, down, 2) - at(column, up, 2);
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const length = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      const index = (row * columns + column) * 3;
      out[index] = nx / length;
      out[index + 1] = ny / length;
      out[index + 2] = nz / length;
    }
  }
}
