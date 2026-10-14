/**
 * The light a book is read by, and the paper it falls on: what the leaf's
 * shading and its shadow are both worked out from, so that they agree.
 *
 * The room is lit softly: nearly all the light comes from all around (the
 * sky, the walls), the rest from one large window over the reader's left
 * shoulder. The shares and sizes are set so that a page curled over reads
 * as in the reference recording of Apple Books' curl, measured at its own
 * resolution: no darker than about 0.87 of the paper at the fold and 0.96
 * at the turned paper's edge.
 */

/** The direction the lamp's light comes from, a unit vector: x right, y down, z toward the reader. */
export const KEY_DIRECTION = normalized([-0.28, -0.12, 0.95]);

/** The share of the light on a page lying flat that comes from the lamp; the rest comes from all around. */
export const KEY_SHARE = 0.1;

/**
 * How large the lamp looks from the page: the tangent of half the angle it
 * spans. A shadow's edge is as soft as this times the height of the paper
 * that casts it.
 */
export const KEY_SIZE = 0.5;

/**
 * The share of the light falling on a sheet that comes out of its other
 * side. Office paper is sold as 90–94% opaque.
 */
export const PAPER_THROUGH = 0.09;

/**
 * How much of what is printed on a sheet shows through from its back, where
 * nothing is printed there: of a leaf, faintly; of a page curled over on
 * itself, plainly, for its back is all there is to tell it by, as much as
 * in the reference recording.
 */
export const SHOWS_THROUGH = 0.05;
export const SHOWS_THROUGH_CURLED = 0.4;

/**
 * What paper standing between a point and the sky gives that point of the
 * sky's light it hides: it is lit itself, from beneath by the white page it
 * stands over and through itself from above. Set to what the reference
 * recording shows; it is a look, not worked out from the paper.
 */
export const HANDED_BACK = 0.9;

function normalized(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
