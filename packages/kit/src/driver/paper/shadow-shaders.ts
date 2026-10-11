import { BOUNCES, PROJECTION } from './shaders';
import { LEAF_SKY, ROLL_SKY } from './shadow-sky';

/**
 * The leaf as the lamp throws it onto the pages: each point drawn where
 * its shadow would fall were the lamp a single point, carrying how high
 * above the page it is. Paper lying on the page blocks nothing.
 */
export const CAST_VERTEX = `
attribute vec3 aPosition;
uniform vec2 uCast;
varying float vHeight;
${PROJECTION}
void main() {
  float height = max(aPosition.z, 0.0);
  vHeight = height;
  gl_Position = project(vec3(aPosition.xy + uCast * height, 0.0), 0.0);
}
`;

export const CAST_FRAGMENT = `
precision mediump float;
uniform float uTallest;
uniform float uPixel;
varying float vHeight;
void main() {
  gl_FragColor = vec4(vHeight / uTallest, 0.0, 0.0, smoothstep(0.0, 1.5 * uPixel, vHeight));
}
`;

/**
 * A sheet as the eye sees it: wherever it is drawn, it hides the pages.
 * What of it lies on the pages hides nothing of them: it is where the
 * shadow falls. `uOffPage` leaves that part out, for a sheet whose lying
 * part is drawn under the shadows.
 */
export const COVER_VERTEX = `
attribute vec3 aPosition;
varying float vHeight;
${PROJECTION}
void main() {
  vHeight = aPosition.z;
  gl_Position = project(aPosition, 0.0);
}
`;

export const COVER_FRAGMENT = `
precision highp float;
uniform float uOffPage;
varying float vHeight;
void main() {
  if (vHeight <= uOffPage) discard;
  gl_FragColor = vec4(1.0);
}
`;

/**
 * A place read for the page `vAt` is on. The two pages meet at the spine
 * and are not lit alike there: a leaf rises from that line, so under it one
 * page is in deep shade to the very line where the other lies open, and its
 * shadow begins there sharp. So nothing worked out for one page is read for
 * the other: a place across the spine from `vAt` is read as the middle of
 * the texel next to the spine on its own side (`uBeside`, left and right).
 * `uSpineAt` is where the pages part across what is drawn to, 0–1.
 */
const OWN_PAGE = `
uniform float uSpineAt;
uniform vec2 uBeside;
vec2 onOwnPage(vec2 at) {
  return vec2(vAt.x > uSpineAt ? max(at.x, uBeside.y) : min(at.x, uBeside.x), at.y);
}
`;

/**
 * How much darker the leaf leaves each point of the pages beneath it.
 *
 * From the lamp, a soft shadow as Fernando's percentage-closer soft
 * shadows find it: the paper that could block the lamp from here is
 * averaged for its height, the lamp's size times that height is how wide
 * the shadow's edge is here, and the share of that width the paper covers
 * is how much of the lamp it hides. A shadow is sharp where the leaf meets
 * the page and soft where it stands high above it.
 *
 * From the room, the share of the sky the sheet hides, and by the spine a
 * leaf's own shade: see `shadow-sky.ts`, which tells a leaf swung about the
 * spine from a page curled over.
 *
 * What comes out is how much of each point counts, in red, and its darkness
 * times that, in alpha. A point `uCover` says a leaf hides from the eye
 * counts for nothing: under a leaf that lies almost on the page it is as
 * dark as can be, and smoothing would draw that out past the leaf's edge.
 */
export const OCCLUSION_FRAGMENT = `
precision highp float;
uniform sampler2D uBlockers;
uniform sampler2D uCover;
uniform vec2 uSize;
uniform float uTallest;
uniform float uKeySize;
uniform float uKeyShare;
uniform float uThrough;
uniform float uSpine;
uniform float uGutter;
uniform vec3 uLight;
uniform vec3 uProfile[32];
uniform vec4 uRoll;
varying vec2 vAt;

const float TURN = 6.2831853;
${BOUNCES}
${OWN_PAGE}

vec2 around(int index, float count, float turned) {
  float i = float(index);
  float angle = i * 2.3999632 + turned;
  return sqrt((i + 0.5) / count) * vec2(cos(angle), sin(angle));
}

// The paper between the lamp and a place on the point's own page. Past the frame's edge it is
// what stands at the edge: a leaf's shadow that runs off the frame goes on beyond it.
vec4 blocker(vec2 at) {
  return texture2D(uBlockers, onOwnPage(at));
}

float hiddenLamp(vec2 at, float turned) {
  vec2 widest = uKeySize * uTallest / uSize;
  float height = 0.0;
  float found = 0.0;
  for (int i = 0; i < 16; i++) {
    vec4 paper = blocker(at + around(i, 16.0, turned) * widest);
    height += paper.r * paper.a;
    found += paper.a;
  }
  if (found < 0.01) return 0.0;
  vec2 edge = max(uKeySize * (height / found) * uTallest, 1.0) / uSize;
  float covered = 0.0;
  for (int i = 0; i < 24; i++) covered += blocker(at + around(i, 24.0, turned) * edge).a;
  return covered / 24.0;
}

${LEAF_SKY}
${ROLL_SKY}

void main() {
  if (texture2D(uCover, vAt).r > 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 point = vec2(vAt.x, 1.0 - vAt.y) * uSize;
  float turned = TURN * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float lamp = 1.0 - (1.0 - uThrough) * hiddenLamp(vAt, turned);
  // A page curled over has a radius, a leaf has none: each hides the sky its own way,
  // and only a leaf shades the page beside it at the spine.
  if (uRoll.w >= 0.0) {
    float under = withBounces(1.0 - hiddenByRoll(point));
    gl_FragColor = vec4(vec3(1.0), 1.0 - (uKeyShare * lamp + (1.0 - uKeyShare) * under));
    return;
  }
  float room = withBounces(1.0 - hiddenSky(point));
  float shadowed = 1.0 - (uKeyShare * lamp + (1.0 - uKeyShare) * room);
  gl_FragColor = vec4(vec3(1.0), max(shadowed, byTheSpine(point)));
}
`;

export const QUAD_VERTEX = `
attribute vec2 aCorner;
varying vec2 vAt;
void main() {
  vAt = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

/**
 * What was worked out at a place of `uSource`, for the page `vAt` is on:
 * how much of it counts, in red, and its darkness times that, in alpha.
 */
const WORKED_OUT = `
precision highp float;
uniform sampler2D uSource;
varying vec2 vAt;
${OWN_PAGE}
vec4 workedOut(vec2 at) {
  return texture2D(uSource, onOwnPage(at));
}
`;

/**
 * One pass of a soft blur along `uStep`. Both what counts and the darkness
 * times it are spread, so a place hidden from the eye adds nothing to its
 * neighbours and takes its darkness from those in sight.
 */
export const BLUR_FRAGMENT = `${WORKED_OUT}
uniform vec2 uStep;
void main() {
  vec4 sum = workedOut(vAt) * 0.227;
  sum += (workedOut(vAt + uStep * 1.385) + workedOut(vAt - uStep * 1.385)) * 0.316;
  sum += (workedOut(vAt + uStep * 3.231) + workedOut(vAt - uStep * 3.231)) * 0.070;
  gl_FragColor = sum;
}
`;

/** The blurred shadow laid over the pages as darkness: what was spread, over how much of it counted. */
export const SHADOW_FRAGMENT = `${WORKED_OUT}
uniform float uStrength;
void main() {
  vec4 spread = workedOut(vAt);
  float dark = min(spread.a / max(spread.r, 0.004), 1.0);
  gl_FragColor = vec4(0.0, 0.0, 0.0, dark * uStrength);
}
`;
