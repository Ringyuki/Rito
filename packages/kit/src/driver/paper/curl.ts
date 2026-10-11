/**
 * A sheet of paper rolled back over itself: flat as far as a fold line,
 * round half a cylinder lying along that line, then flat again on top, face
 * down, going back the way it came. Paper bends without stretching, and
 * this is a shape it can take: every distance along the sheet stays what it
 * was flat.
 *
 * Lengths are in the units a frame is drawn in: x across the spread, y down
 * it, z rising toward the reader. The sheet lies to the right of the spine,
 * bound to it along its left edge.
 */

export interface CurlPoint {
  readonly x: number;
  readonly y: number;
}

/** Where the sheet is bound and how large it is. */
export interface SheetShape {
  readonly spine: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A fold: the direction the sheet is rolled back from (a unit vector in the
 * page, pointing from the paper still lying flat to the paper lifted), where
 * the fold line lies along it, and the radius the paper rolls over at.
 */
export interface Fold {
  readonly dx: number;
  readonly dy: number;
  readonly at: number;
  readonly radius: number;
}

/**
 * The nearest point to `to` that the point `from` of the sheet can be
 * carried to without tearing the sheet from its spine: no farther from
 * either end of the spine than it is when the sheet lies flat.
 */
export function withinReach(from: CurlPoint, to: CurlPoint, shape: SheetShape): CurlPoint {
  let { x, y } = to;
  // Two passes settle a point outside both circles onto where they meet.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const end of [0, shape.height]) {
      const reach = Math.hypot(from.x - shape.spine, from.y - end);
      const away = Math.hypot(x - shape.spine, y - end);
      if (away <= reach || away === 0) continue;
      x = shape.spine + ((x - shape.spine) * reach) / away;
      y = end + ((y - end) * reach) / away;
    }
  }
  return { x, y };
}

/**
 * The fold that carries the point `from` of the flat sheet to lie at `to`,
 * rolling over at `radius`; null while the point has not moved. The fold
 * never reaches past the spine: the paper bound there stays flat.
 */
export function foldBetween(
  from: CurlPoint,
  to: CurlPoint,
  radius: number,
  shape: SheetShape,
): Fold | null {
  const moved = Math.hypot(from.x - to.x, from.y - to.y);
  if (moved < 1e-3) return null;
  const dx = (from.x - to.x) / moved;
  const dy = (from.y - to.y) / moved;
  // Half way between where the point was and where it is, less what the roll takes up.
  const at = from.x * dx + from.y * dy - (moved + Math.PI * radius) / 2;
  const spineTop = shape.spine * dx;
  const spineBottom = shape.spine * dx + shape.height * dy;
  return { dx, dy, at: Math.max(at, spineTop, spineBottom), radius };
}

/** Paper this near the fold line is on it: what a fold with no roll turns over. */
const ON_THE_FOLD = 1e-3;

/**
 * Lays the sheet out through a fold: the position of every point of a grid
 * of `columns` by `rows` over the sheet, row by row from the spine outward,
 * and the direction the paper faces there. A null fold lays it flat.
 */
export function layOut(
  shape: SheetShape,
  fold: Fold | null,
  columns: number,
  rows: number,
  positions: Float32Array,
  normals: Float32Array,
): void {
  const halfTurn = fold ? Math.PI * fold.radius : 0;
  for (let row = 0; row < rows; row += 1) {
    const flatY = (row / (rows - 1)) * shape.height;
    for (let column = 0; column < columns; column += 1) {
      const flatX = shape.spine + (column / (columns - 1)) * shape.width;
      const p = (row * columns + column) * 3;
      // How far past the fold line this point of the sheet is.
      const past = fold ? flatX * fold.dx + flatY * fold.dy - fold.at : 0;
      if (!fold || past < -ON_THE_FOLD) {
        set(positions, p, flatX, flatY, 0);
        set(normals, p, 0, 0, 1);
      } else if (past < halfTurn) {
        // Round the cylinder: `angle` of the way from lying flat to lying on top.
        const angle = past / fold.radius;
        const back = past - fold.radius * Math.sin(angle);
        set(
          positions,
          p,
          flatX - fold.dx * back,
          flatY - fold.dy * back,
          fold.radius * (1 - Math.cos(angle)),
        );
        const lean = Math.sin(angle);
        set(normals, p, -fold.dx * lean, -fold.dy * lean, Math.cos(angle));
      } else {
        // On top, face down, as far back from the fold as it reached past it.
        const back = 2 * past - halfTurn;
        set(positions, p, flatX - fold.dx * back, flatY - fold.dy * back, 2 * fold.radius);
        set(normals, p, 0, 0, -1);
      }
    }
  }
}

function set(into: Float32Array, at: number, x: number, y: number, z: number): void {
  into[at] = x;
  into[at + 1] = y;
  into[at + 2] = z;
}
