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
 * face of it the reader sees, and spread between them: paper folded hard,
 * facing up on both sides of the crease, is then lit alike across it.
 */
export const SHEET_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform float uDepth;
uniform vec3 uLight;
varying float vLit;
varying float vSheen;
varying vec3 vAt;
varying vec2 vUv;
${PROJECTION}
void main() {
  vec3 facing = aNormal.z >= 0.0 ? aNormal : -aNormal;
  vLit = dot(facing, uLight) / uLight.z;
  vec3 halfway = normalize(uLight + vec3(0.0, 0.0, 1.0));
  vSheen = pow(max(dot(facing, halfway), 0.0), 40.0) - pow(halfway.z, 40.0);
  vAt = aPosition;
  vUv = aUv;
  gl_Position = project(aPosition, -aPosition.z / uDepth);
}
`;

/**
 * Both faces of the sheet. The front shows the spread it is lifted from,
 * the back the spread it lands on, mirrored; a back with nothing printed
 * on it is bare paper, the colour of the page's own margin, with the front
 * showing faintly through. Paper lying flat is exactly the page's own
 * colours; where it rolls it dims toward the side turned from the light,
 * and what lies low takes the shadow of the paper rolled over it.
 */
export const SHEET_FRAGMENT = `
precision highp float;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform sampler2D uShadow;
uniform float uHasFront;
uniform float uHasBack;
uniform float uSpine;
uniform float uSheet;
uniform vec2 uSize;
uniform float uLift;
uniform float uShadowStrength;
uniform vec3 uPaper;
varying float vLit;
varying float vSheen;
varying vec3 vAt;
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
      : mix(bare, front, 0.05) * 0.965;
  }
  float shade = clamp(0.8 + 0.2 * vLit, 0.8, 1.03);
  float under = texture2D(uShadow, vec2(vAt.x / uSize.x, 1.0 - vAt.y / uSize.y)).a;
  float low = 1.0 - smoothstep(0.0, uLift, vAt.z);
  colour *= shade * (1.0 - uShadowStrength * under * low);
  gl_FragColor = vec4(colour + max(vSheen, 0.0) * 0.1, 1.0);
}
`;

/**
 * The sheet as the light throws it onto what lies beneath: each point
 * lands where its shadow falls. Paper lying on the page casts none.
 */
export const CAST_VERTEX = `
attribute vec3 aPosition;
uniform vec2 uCast;
uniform float uLift;
varying float vDark;
${PROJECTION}
void main() {
  float height = max(aPosition.z, 0.0);
  vDark = smoothstep(0.0, 0.5 * uLift, height);
  gl_Position = project(vec3(aPosition.xy + uCast * height, 0.0), 0.0);
}
`;

export const CAST_FRAGMENT = `
precision mediump float;
varying float vDark;
void main() {
  gl_FragColor = vec4(vDark);
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
