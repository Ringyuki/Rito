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
 * face of it the reader sees, and spread between them. White paper in a
 * lit room is bright on every side: a face turned from the light dims by a
 * few parts in a hundred, no more, and the paper near the spine a little
 * further where a steep leaf closes the light off. Paper lying flat is lit
 * to exactly 1.
 */
export const SHEET_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform float uDepth;
uniform vec3 uLight;
varying float vLit;
varying vec2 vUv;
${PROJECTION}
void main() {
  vec3 toEye = vec3(0.5 * uSize - aPosition.xy, uEye - aPosition.z);
  vec3 facing = dot(aNormal, toEye) >= 0.0 ? aNormal : -aNormal;
  float toward = clamp(dot(facing, uLight) / uLight.z, -1.0, 1.0);
  float steep = 1.0 - abs(aNormal.z);
  vLit = 0.5 + 0.5 * toward - 0.45 * steep * exp(-aUv.x / 0.2);
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
  gl_FragColor = vec4(colour * (0.86 + 0.14 * vLit), 1.0);
}
`;

/**
 * The leaf as the light throws it onto the pages: each point lands where
 * its shadow falls, darkest where the paper is just off the page and
 * fading the higher it is. Paper lying on the page casts none.
 */
export const CAST_VERTEX = `
attribute vec3 aPosition;
uniform vec2 uCast;
uniform float uFade;
varying float vDark;
${PROJECTION}
void main() {
  float height = max(aPosition.z, 0.0);
  vDark = exp(-height / uFade) * smoothstep(0.0, 0.08 * uFade, height);
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
