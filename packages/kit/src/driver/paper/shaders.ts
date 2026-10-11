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

export const SHEET_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform float uDepth;
varying vec3 vNormal;
varying vec2 vUv;
${PROJECTION}
void main() {
  vNormal = aNormal;
  vUv = aUv;
  gl_Position = project(aPosition, -aPosition.z / uDepth);
}
`;

/**
 * Both faces of the sheet. The front shows the spread it is lifted from,
 * the back the spread it lands on, mirrored; a back with nothing printed
 * on it is bare paper, the colour of the page's own margin, with the front
 * showing faintly through. A flat sheet is lit to exactly the page's own
 * colours, so lifting it changes nothing until it tilts.
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
uniform vec3 uLight;
varying vec3 vNormal;
varying vec2 vUv;

vec3 printed(sampler2D page, vec2 at) {
  vec4 ink = texture2D(page, at);
  return ink.rgb + uPaper * (1.0 - ink.a);
}

void main() {
  vec3 normal = normalize(vNormal);
  vec2 onFront = vec2(uSpine + vUv.x * uSheet, vUv.y);
  vec3 front = uHasFront > 0.5 ? printed(uFront, onFront) : uPaper;
  vec3 colour = front;
  if (!gl_FrontFacing) {
    normal = -normal;
    vec2 onBack = vec2(uSpine - vUv.x * uSheet, vUv.y);
    vec3 bare = uHasFront > 0.5 ? printed(uFront, vec2(uSpine + 0.985 * uSheet, 0.012)) : uPaper;
    colour = uHasBack > 0.5 && onBack.x >= 0.0
      ? printed(uBack, onBack)
      : mix(bare, front, 0.06) * 0.975;
  }
  // Paper lets light through: a face turned from the light is dimmer, not dark.
  float toward = dot(normal, uLight) / uLight.z;
  float lit = max(toward, 0.0) + 0.72 * max(-toward, 0.0);
  float shade = min(0.66 + 0.34 * lit, 1.05);
  vec3 halfway = normalize(uLight + vec3(0.0, 0.0, 1.0));
  float sheen = pow(max(dot(normal, halfway), 0.0), 26.0) - pow(halfway.z, 26.0);
  gl_FragColor = vec4(colour * shade + max(sheen, 0.0) * 0.18, 1.0);
}
`;

/**
 * The sheet as the light throws it onto the pages: each point lands where
 * its shadow falls. Paper lying on the page casts none, and the higher it
 * rises the fainter its shadow.
 */
export const CAST_VERTEX = `
attribute vec3 aPosition;
uniform vec2 uCast;
uniform float uReach;
varying float vDark;
${PROJECTION}
void main() {
  float height = max(aPosition.z, 0.0);
  vDark = smoothstep(0.0, 0.04 * uReach, height) * mix(1.0, 0.2, min(height / (0.7 * uReach), 1.0));
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
