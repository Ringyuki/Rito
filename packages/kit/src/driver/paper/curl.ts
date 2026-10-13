/**
 * A page curled over on itself, as one page of a spread is turned: flat as
 * far as a line across it, round half a cylinder lying along that line,
 * then flat again on top, face down, going back the way it came. Paper
 * bends without stretching, and this is a shape it can take: every distance
 * along the sheet stays what it was flat.
 *
 * The line it leaves the page at is all there is to the shape. It runs from
 * the top edge of the page to the bottom, the paper bound at the spine lying
 * flat on its left and the paper on its right lifted. It comes in from the
 * outer edge as the turn goes on and stands the more upright the nearer the
 * spine it is, so that it never crosses the spine, and lies along it when
 * the turn is done.
 *
 * Lengths are in the units a frame is drawn in: x across the page, y down
 * it, z rising toward the reader.
 */
import type { LeafShape } from './leaf';

/** Where the line a page leaves the pages at meets the page's top edge and its bottom, as x. */
export interface CurlLine {
  readonly top: number;
  readonly bottom: number;
}

/**
 * The curl as it is laid out: the direction across the page it is rolled
 * back from (a unit vector, from the paper lying flat to the paper lifted),
 * where the line it leaves the page at lies along that direction, and the
 * radius it rolls over at.
 */
export interface Curl {
  readonly dx: number;
  readonly dy: number;
  readonly at: number;
  readonly radius: number;
}

/**
 * The radius the paper rolls over at, as a share of the page's width: a
 * soft roll, its light and shade spread across it, as the page of the
 * reference recording rolls; at a twentieth it read as a crease.
 */
const ROLL = 0.13;
/**
 * How far the line may lean, as the tangent of its angle from upright, for
 * each page height its leading end is from the spine: at this, the end that
 * trails is no farther from the spine than the leading one by as much again
 * and a half.
 */
const LEANS_AT_MOST = 1.5;
/** A roll tighter than this, in the frame's units, is a crease. */
const A_CREASE = 1e-3;

/**
 * The line a page `shown` of the way through its turn (0 lying flat, 1
 * turned) leaves the pages at, leaning by `lean`: the tangent of its angle
 * from upright, above zero when its lower end leads. The leading end comes
 * in evenly from the outer edge to the spine; at 0 the line only touches a
 * corner, and at 1 it lies along the spine.
 */
export function lineAt(shape: LeafShape, shown: number, lean: number): CurlLine {
  const out = shape.width * (1 - Math.min(1, Math.max(0, shown)));
  const most = (LEANS_AT_MOST * out) / shape.height;
  const leans = Math.min(most, Math.max(-most, lean));
  const lead = shape.spine + out;
  return {
    top: lead + shape.height * Math.max(leans, 0),
    bottom: lead + shape.height * Math.max(-leans, 0),
  };
}

/**
 * The line of a page that lies behind another in the book: its own, but
 * nowhere nearer the spine than the line of the page in front, which lies
 * on it there.
 */
export function behind(own: CurlLine, front: CurlLine): CurlLine {
  return { top: Math.max(own.top, front.top), bottom: Math.max(own.bottom, front.bottom) };
}

/**
 * The curl that leaves the page at `line`. It rolls over at a radius that
 * the paper between the line and the spine has room for: near the spine the
 * roll tightens, and along it there is none.
 */
export function curlThrough(shape: LeafShape, line: CurlLine): Curl {
  const across = line.top - line.bottom;
  const length = Math.hypot(shape.height, across);
  const dx = shape.height / length;
  const dy = across / length;
  const lead = Math.min(line.top, line.bottom) - shape.spine;
  return {
    dx,
    dy,
    at: line.top * dx,
    radius: Math.max(0, Math.min(ROLL * shape.width, (2 * lead * dx) / Math.PI)),
  };
}

/** How far past the line it leaves the page at the point (x, y) of the flat sheet is. */
function pastOf(curl: Curl, x: number, y: number): number {
  return x * curl.dx + y * curl.dy - curl.at;
}

/**
 * How far back toward the spine paper is laid that lay `past` beyond the
 * line when flat, round a roll of `radius`: round the roll it comes back by
 * what the roll takes up, and on top of it by twice what is left.
 */
export function laidBack(past: number, radius: number): number {
  if (past <= 0) return 0;
  const halfTurn = Math.PI * radius;
  return past < halfTurn && radius > A_CREASE
    ? past - radius * Math.sin(past / radius)
    : 2 * past - halfTurn;
}

/** How high above the pages that paper stands. */
export function standsAt(past: number, radius: number): number {
  if (past <= 0) return 0;
  return past < Math.PI * radius && radius > A_CREASE
    ? radius * (1 - Math.cos(past / radius))
    : 2 * radius;
}

/**
 * Lays the sheet out through a curl: the position of every point of a grid
 * of `columns` by `rows` over it, row by row from the spine outward, and
 * the direction the paper faces there (its front, the side up when it lies
 * flat).
 */
export function layCurl(
  shape: LeafShape,
  curl: Curl,
  columns: number,
  rows: number,
  positions: Float32Array,
  normals: Float32Array,
): void {
  const { dx, dy, radius } = curl;
  const halfTurn = Math.PI * radius;
  for (let row = 0; row < rows; row += 1) {
    const flatY = (row / (rows - 1)) * shape.height;
    for (let column = 0; column < columns; column += 1) {
      const flatX = shape.spine + (column / (columns - 1)) * shape.width;
      const p = (row * columns + column) * 3;
      const past = pastOf(curl, flatX, flatY);
      const back = laidBack(past, radius);
      set(positions, p, flatX - dx * back, flatY - dy * back, standsAt(past, radius));
      if (past <= 0) {
        set(normals, p, 0, 0, 1);
      } else if (past < halfTurn && radius > A_CREASE) {
        // Round the roll: this far of the way from lying flat to lying on top.
        const angle = past / radius;
        set(normals, p, -dx * Math.sin(angle), -dy * Math.sin(angle), Math.cos(angle));
      } else {
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
