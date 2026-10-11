import { BOUNCES, PROJECTION } from './shaders';

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
 * The leaf as the eye sees it: wherever it is drawn, it hides the pages.
 */
export const COVER_VERTEX = `
attribute vec3 aPosition;
${PROJECTION}
void main() {
  gl_Position = project(aPosition, 0.0);
}
`;

export const COVER_FRAGMENT = `
precision mediump float;
void main() {
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
 * From the room, the share of the sky the leaf hides. Each row of the
 * leaf is taken as a strip running the height of the page, bound at the
 * spine, and what it hides from a point is everything between the horizon
 * on the spine's side and the farthest over the point it reaches: by the
 * spine on the open side that is the slope the leaf leaves it at, far off
 * it is the leaf's outer edge, and under the leaf it is all but what shows
 * past that edge. The page under a leaf is in its shade like any other, and
 * is in sight wherever the leaf leans toward the eye, as it does with one
 * page a spread. A bent leaf ends short of the page's top and bottom, and a
 * point past its end is not under it: the leaf hides from it no more than
 * from a point at its very edge, half the sky, and less the farther past
 * the end it lies for how high the end stands. The light the white pages
 * hand back and forth is restored by the fit Jimenez and others give for
 * surfaces of one albedo.
 *
 * And by the spine, the leaf's own shade. The pages of a book are bound
 * together: the page beside a standing leaf rises to meet it at the spine
 * and is lit there as the foot of the leaf is, so the leaf's shade runs on
 * across the spine and fades into the page instead of stopping at a line.
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

// One stretch of an end of the leaf, and a point of the page. Where the stretch passes over the
// point's place across the page: how far down the page the point is from it (x), how high it
// stands there (y), and 1. What was found before is kept if it is nearer; its z is below zero for none.
vec3 nearer(vec3 found, vec2 point, vec3 from, vec3 to, float down) {
  float span = to.x - from.x;
  if (abs(span) < 0.001) return found;
  float t = (point.x - from.x) / span;
  if (t < 0.0 || t > 1.0) return found;
  vec3 over = mix(from, to, t);
  float past = down * (point.y - over.y);
  return found.z < 0.0 || past < found.x ? vec3(past, max(over.z, 0.0), 1.0) : found;
}

// The same for a whole end, which runs from the spine at foot out through four points of the leaf.
vec3 pastEnd(vec2 point, vec3 foot, vec3 a, vec3 b, vec3 c, vec3 d, float down) {
  vec3 found = vec3(0.0, 0.0, -1.0);
  found = nearer(found, point, foot, a, down);
  found = nearer(found, point, a, b, down);
  found = nearer(found, point, b, c, down);
  return nearer(found, point, c, d, down);
}

// What is left of the sky a leaf hides from a point that lies beyond an end of it, by how far
// (x) for how high the end stands (y); nothing changes where the point lies within the leaf's ends.
float pastTheEnd(float hidden, vec3 past) {
  if (past.z < 0.0 || past.x <= 0.0) return hidden;
  return min(hidden, 0.5) * (1.0 - past.x / length(past.xy));
}

float hiddenSky(vec2 point) {
  float along = clamp(point.y / uSize.y, 0.0, 1.0) * 7.0;
  // How far over the point the leaf reaches, from the horizon on the left and from the one on the right.
  float lowestLeft = 3.1415927;
  float highestRight = 0.0;
  for (int column = 0; column < 4; column++) {
    vec3 paper = vec3(0.0);
    for (int row = 0; row < 8; row++) {
      paper += uProfile[row * 4 + column] * clamp(1.0 - abs(along - float(row)), 0.0, 1.0);
    }
    float toPaper = atan(max(paper.z, 0.0), paper.x - point.x);
    lowestLeft = min(lowestLeft, toPaper);
    highestRight = max(highestRight, toPaper);
  }
  // The leaf rises from the spine, so that is the side it hides the sky from, hanging over the point or not.
  float hidden = vAt.x > uSpineAt ? 0.5 * (1.0 + cos(lowestLeft)) : 0.5 * (1.0 - cos(highestRight));
  vec3 top = vec3(uSpine, 0.0, 0.0);
  vec3 bottom = vec3(uSpine, uSize.y, 0.0);
  hidden = pastTheEnd(hidden, pastEnd(point, top, uProfile[0], uProfile[1], uProfile[2], uProfile[3], -1.0));
  return pastTheEnd(
    hidden,
    pastEnd(point, bottom, uProfile[28], uProfile[29], uProfile[30], uProfile[31], 1.0)
  );
}

// The light on a face of the leaf by the spine that looks that way across and up, lit as the leaf itself is.
float lightOn(vec2 facing) {
  float square = (facing.x * uLight.x + facing.y * uLight.z) / uLight.z;
  float lamp = max(square, 0.0) + uThrough * max(-square, 0.0);
  return min(uKeyShare * lamp + (1.0 - uKeyShare) * withBounces(0.5 + 0.5 * facing.y), 1.0);
}

float byTheSpine(vec2 point) {
  float along = clamp(point.y / uSize.y, 0.0, 1.0) * 7.0;
  vec3 foot = vec3(0.0);
  for (int row = 0; row < 8; row++) {
    foot += uProfile[row * 4] * clamp(1.0 - abs(along - float(row)), 0.0, 1.0);
  }
  // How the leaf leaves the spine: across and up.
  vec2 rise = vec2(foot.x - uSpine, max(foot.z, 0.0));
  float reach = length(rise);
  if (reach < 0.0001) return 0.0;
  rise /= reach;
  // The face of the leaf the reader sees, and the face that looks at this side of the spine.
  // They are one unless the leaf leans over this side, and then the page is out of sight
  // under it until the leaf stands nearly upright.
  vec2 seen = rise.x >= 0.0 ? vec2(-rise.y, rise.x) : vec2(rise.y, -rise.x);
  vec2 beside = point.x < uSpine ? vec2(-rise.y, rise.x) : vec2(rise.y, -rise.x);
  float lit = mix(lightOn(seen), lightOn(beside), smoothstep(0.8, 1.0, rise.y));
  return (1.0 - lit) * exp(-abs(point.x - uSpine) / uGutter);
}

void main() {
  if (texture2D(uCover, vAt).r > 0.5) {
    gl_FragColor = vec4(0.0);
    return;
  }
  vec2 point = vec2(vAt.x, 1.0 - vAt.y) * uSize;
  float turned = TURN * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float lamp = 1.0 - (1.0 - uThrough) * hiddenLamp(vAt, turned);
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
