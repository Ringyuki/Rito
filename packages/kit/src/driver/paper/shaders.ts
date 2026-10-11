/**
 * The shaders of the paper turn. Positions are in the units a frame is
 * drawn in, z rising toward the reader; the eye looks straight down from
 * `uEye` above the middle of the spread, so the pages at z = 0 land exactly
 * on the canvas and whatever rises from them grows toward the reader.
 */

const PROJECTION = `
uniform vec2 uSize;
uniform float uEye;
vec4 project(vec3 at, float depth) {
  float w = (uEye - at.z) / uEye;
  vec2 centred = (at.xy - 0.5 * uSize) / (0.5 * uSize);
  return vec4(centred.x, -centred.y, depth * w, w);
}
`;

/**
 * The light on the paper is worked out at each point of the grid, for the
 * face of it the reader sees, and spread between them. The lamp lights a
 * face by how squarely it meets it, and a face turned from it by what
 * comes through the paper; the room lights it by how much of the sky it
 * sees, and the pages below give some of their own light back to the rest.
 * Paper lying flat is lit to exactly 1.
 */
export const SHEET_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform float uDepth;
uniform vec3 uLight;
uniform float uKeyShare;
uniform float uThrough;
uniform float uAlbedo;
varying float vLit;
varying vec2 vUv;
${PROJECTION}
void main() {
  vec3 toEye = vec3(0.5 * uSize - aPosition.xy, uEye - aPosition.z);
  vec3 facing = dot(aNormal, toEye) >= 0.0 ? aNormal : -aNormal;
  float square = dot(facing, uLight) / uLight.z;
  float lamp = max(square, 0.0) + uThrough * max(-square, 0.0);
  float sky = 0.5 + 0.5 * facing.z;
  float room = sky + uAlbedo * (1.0 - sky);
  vLit = uKeyShare * lamp + (1.0 - uKeyShare) * room;
  vUv = aUv;
  gl_Position = project(aPosition, -aPosition.z / uDepth);
}
`;

/**
 * Both faces of the leaf. The front shows the spread it is lifted from,
 * the back the spread it lands on, mirrored; a back with nothing printed
 * on it is bare paper, the colour of the page's own margin, with the front
 * showing faintly through. Paper lying flat is exactly the page's own
 * colours.
 */
export const SHEET_FRAGMENT = `
precision highp float;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uHasFront;
uniform float uHasBack;
uniform float uSpine;
uniform float uSheet;
uniform vec3 uPaper;
varying float vLit;
varying vec2 vUv;

vec3 printed(sampler2D page, vec2 at) {
  vec4 ink = texture2D(page, at);
  return ink.rgb + uPaper * (1.0 - ink.a);
}

void main() {
  vec2 onFront = vec2(uSpine + vUv.x * uSheet, vUv.y);
  vec3 front = uHasFront > 0.5 ? printed(uFront, onFront) : uPaper;
  vec3 colour = front;
  if (!gl_FrontFacing) {
    vec2 onBack = vec2(uSpine - vUv.x * uSheet, vUv.y);
    vec3 bare = uHasFront > 0.5 ? printed(uFront, vec2(uSpine + 0.985 * uSheet, 0.012)) : uPaper;
    colour = uHasBack > 0.5 && onBack.x >= 0.0
      ? printed(uBack, onBack)
      : mix(bare, front, 0.05) * 0.97;
  }
  gl_FragColor = vec4(colour * min(vLit, 1.0), 1.0);
}
`;

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
 * How much darker the leaf leaves each point of the pages beneath it.
 *
 * From the lamp, a soft shadow as Fernando's percentage-closer soft
 * shadows find it: the paper that could block the lamp from here is
 * averaged for its height, the lamp's size times that height is how wide
 * the shadow's edge is here, and the share of that width the paper covers
 * is how much of the lamp it hides. A shadow is sharp where the leaf meets
 * the page and soft where it stands high above it.
 *
 * From the room, the share of the sky the leaf hides, taking each row of
 * the leaf as a straight strip from the spine to its outer edge, with the
 * light the white pages hand back and forth restored by the fit Jimenez
 * and others give for surfaces of one albedo.
 */
export const OCCLUSION_FRAGMENT = `
precision highp float;
uniform sampler2D uBlockers;
uniform vec2 uSize;
uniform float uTallest;
uniform float uKeySize;
uniform float uKeyShare;
uniform float uThrough;
uniform float uAlbedo;
uniform float uSpine;
uniform vec3 uEdge[8];
varying vec2 vAt;

const float TURN = 6.2831853;

vec2 around(int index, float count, float turned) {
  float i = float(index);
  float angle = i * 2.3999632 + turned;
  return sqrt((i + 0.5) / count) * vec2(cos(angle), sin(angle));
}

vec4 blocker(vec2 at) {
  vec2 inside = step(vec2(0.0), at) * step(at, vec2(1.0));
  return texture2D(uBlockers, at) * inside.x * inside.y;
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

float hiddenSky(vec2 point) {
  float along = clamp(point.y / uSize.y, 0.0, 1.0) * 7.0;
  vec3 tip = vec3(0.0);
  for (int i = 0; i < 8; i++) tip += uEdge[i] * clamp(1.0 - abs(along - float(i)), 0.0, 1.0);
  // Under the leaf the page is out of sight, and must not darken the page beside it.
  if ((point.x - uSpine) * (tip.x - point.x) > 0.0) return 0.0;
  float toTip = atan(max(tip.z, 0.0), tip.x - point.x);
  float toSpine = point.x > uSpine ? 3.1415927 : 0.0;
  return 0.5 * abs(cos(toTip) - cos(toSpine));
}

float withBounces(float seen) {
  float a = 2.0404 * uAlbedo - 0.3324;
  float b = 4.7951 * uAlbedo - 0.6417;
  float c = 2.7552 * uAlbedo + 0.6903;
  return max(seen, ((a * seen - b) * seen + c) * seen);
}

void main() {
  vec2 point = vec2(vAt.x, 1.0 - vAt.y) * uSize;
  float turned = TURN * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float lamp = 1.0 - (1.0 - uThrough) * hiddenLamp(vAt, turned);
  float room = withBounces(1.0 - hiddenSky(point));
  gl_FragColor = vec4(1.0 - (uKeyShare * lamp + (1.0 - uKeyShare) * room));
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

/** One pass of a soft blur along `uStep`. */
export const BLUR_FRAGMENT = `
precision mediump float;
uniform sampler2D uSource;
uniform vec2 uStep;
varying vec2 vAt;
void main() {
  float sum = texture2D(uSource, vAt).a * 0.227;
  sum += (texture2D(uSource, vAt + uStep * 1.385).a + texture2D(uSource, vAt - uStep * 1.385).a) * 0.316;
  sum += (texture2D(uSource, vAt + uStep * 3.231).a + texture2D(uSource, vAt - uStep * 3.231).a) * 0.070;
  gl_FragColor = vec4(sum);
}
`;

/** The blurred shadow laid over the pages as darkness. */
export const SHADOW_FRAGMENT = `
precision mediump float;
uniform sampler2D uSource;
uniform float uStrength;
varying vec2 vAt;
void main() {
  gl_FragColor = vec4(0.0, 0.0, 0.0, texture2D(uSource, vAt).a * uStrength);
}
`;
