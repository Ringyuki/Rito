/**
 * A leaf of a book as it is turned: bound along the spine, bent round a
 * cone that touches the page along the spine, and swung about the spine
 * from one side of the book to the other. Paper bends without stretching,
 * and a cone is a shape it can take: every distance along the leaf stays
 * what it was flat. The leaf arches as much however it is taken: a cone
 * with its point far off bends the whole edge alike, one with its point
 * near lets the corner nearest it lead.
 *
 * Lengths are in the units a frame is drawn in: x across the spread, y down
 * it, z rising toward the reader. The leaf lies to the right of the spine
 * when flat and to its left once turned.
 */

/** Where the leaf is bound and how large it is. */
export interface LeafShape {
  readonly spine: number;
  readonly width: number;
  readonly height: number;
}

/** The point of the leaf a hand holds: `u` from the spine outward, `v` from the top down. */
export interface LeafGrab {
  readonly u: number;
  readonly v: number;
}

/**
 * How the leaf is bent and where it has swung to: how far round the spine
 * (`swing`, 0 lying right, π lying left), the half-angle of the cone it is
 * bent round (`cone`; a right angle is flat), and where on the spine's
 * line the cone's point is (`apex`, a y above the leaf's top or below its
 * bottom).
 */
export interface LeafPose {
  readonly swing: number;
  readonly cone: number;
  readonly apex: number;
}

const FLAT = Math.PI / 2;
/** How far round its cone the middle of the leaf's outer edge wraps once bent, in radians. */
const BEND = 0.95;
/** How far past the leaf's end the cone's point is, in leaf widths: by a corner, by the edge. */
const APEX_BY_CORNER = 1.5;
const APEX_BY_EDGE = 9;
/** The leaf has taken its bend by this share of the turn. */
const BENT_BY = 0.2;

/**
 * The pose of a leaf `turned` of the way over (0–1), held at `grab`. It
 * bends as it lifts, swings evenly, and comes down edge first: on the far
 * side the bend opens no faster than keeps the paper above the page it
 * lands on, so the last of the arch settles as the swing ends.
 */
export function poseAt(shape: LeafShape, grab: LeafGrab, turned: number): LeafPose {
  const t = Math.min(1, Math.max(0, turned));
  // A leaf taken near a corner bends round a nearer point, more tightly.
  const corner = smoothstep(0, 1, Math.abs(2 * grab.v - 1));
  const away = (APEX_BY_EDGE + (APEX_BY_CORNER - APEX_BY_EDGE) * corner) * shape.width;
  const apex = grab.v >= 0.5 ? shape.height + away : -away;
  const swing = Math.PI * t;
  // The cone that wraps the middle of the outer edge that far: tighter the farther off its point.
  const spread = Math.atan2(shape.width, away + shape.height / 2);
  const bend = BEND * smoothstep(0, BENT_BY, t);
  const wanted = bend <= spread ? FLAT : Math.asin(spread / bend);
  return { swing, cone: Math.max(wanted, openEnough(shape, swing, away)), apex };
}

/**
 * The tightest cone that keeps the whole leaf above the page it is coming
 * down on, once it has swung past upright: its lowest paper is the corner
 * nearest the cone's point, which wraps farthest.
 */
function openEnough(shape: LeafShape, swing: number, away: number): number {
  if (swing <= FLAT) return 0;
  const room = Math.tan(Math.PI - swing);
  const spread = Math.atan2(shape.width, away);
  const sinks = (cone: number): boolean =>
    Math.cos(cone) * Math.tan(Math.min(spread / Math.sin(cone), 3) / 2) > room;
  let low = 0.05;
  let high = FLAT;
  for (let pass = 0; pass < 24; pass += 1) {
    const middle = (low + high) / 2;
    if (sinks(middle)) low = middle;
    else high = middle;
  }
  return high;
}

/** Where the point of the flat leaf `out` from the spine and `down` from its top is, in `pose`. */
export function leafPoint(
  shape: LeafShape,
  pose: LeafPose,
  out: number,
  down: number,
): [x: number, y: number, z: number] {
  const below = pose.apex > shape.height;
  const along = below ? pose.apex - down : down - pose.apex;
  const slant = Math.hypot(out, along);
  const sine = Math.sin(pose.cone);
  // How far round the cone the point has wrapped from the spine.
  const round = Math.atan2(out, along) / sine;
  const radius = slant * sine;
  const lifted = radius * (1 - Math.cos(round));
  const across = radius * Math.sin(round);
  const up = lifted * Math.cos(pose.cone);
  const kept = slant - lifted * sine;
  return [
    shape.spine + across * Math.cos(pose.swing) - up * Math.sin(pose.swing),
    below ? pose.apex - kept : pose.apex + kept,
    across * Math.sin(pose.swing) + up * Math.cos(pose.swing),
  ];
}

/**
 * Lays the leaf out in a pose: the position of every point of a grid of
 * `columns` by `rows` over it, row by row from the spine outward, and the
 * direction the paper faces there (its front, the side up when it lies
 * flat on the right).
 */
export function layLeaf(
  shape: LeafShape,
  pose: LeafPose,
  columns: number,
  rows: number,
  positions: Float32Array,
  normals: Float32Array,
): void {
  for (let row = 0; row < rows; row += 1) {
    const down = (row / (rows - 1)) * shape.height;
    for (let column = 0; column < columns; column += 1) {
      const out = (column / (columns - 1)) * shape.width;
      positions.set(leafPoint(shape, pose, out, down), (row * columns + column) * 3);
    }
  }
  facings(positions, columns, rows, normals);
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
      out.set([nx / length, ny / length, nz / length], (row * columns + column) * 3);
    }
  }
}

function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}
