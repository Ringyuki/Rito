/**
 * The light a book is read by, and the paper it falls on: what the leaf's
 * shading and its shadow are both worked out from, so that they agree.
 *
 * The room is lit softly: most of the light comes from all around (the
 * sky, the walls), the rest from one lamp or window over the reader's left
 * shoulder, large enough to cast soft shadows.
 */

/** The direction the lamp's light comes from, a unit vector: x right, y down, z toward the reader. */
export const KEY_DIRECTION = normalized([-0.25, -0.35, 0.9]);

/** The share of the light on a page lying flat that comes from the lamp; the rest comes from all around. */
export const KEY_SHARE = 0.3;

/**
 * How large the lamp looks from the page: the tangent of half the angle it
 * spans. A shadow's edge is as soft as this times the height of the paper
 * that casts it.
 */
export const KEY_SIZE = 0.2;

/**
 * The share of the light falling on a sheet that comes out of its other
 * side. Office paper is sold as 90–94% opaque.
 */
export const PAPER_THROUGH = 0.09;

/** The share of the light falling on a page that it gives back to the room. */
export const PAPER_ALBEDO = 0.85;

function normalized(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
