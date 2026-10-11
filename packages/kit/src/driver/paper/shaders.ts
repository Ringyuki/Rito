/**
 * The shaders of the paper turn. Positions are in the units a frame is
 * drawn in, z rising toward the reader; the eye looks straight down from
 * `uEye` above the middle of the spread, so the pages at z = 0 land exactly
 * on the canvas and whatever rises from them grows toward the reader.
 */

export const PROJECTION = `
uniform vec2 uSize;
uniform float uEye;
vec4 project(vec3 at, float depth) {
  float w = (uEye - at.z) / uEye;
  vec2 centred = (at.xy - 0.5 * uSize) / (0.5 * uSize);
  return vec4(centred.x, -centred.y, depth * w, w);
}
`;

/**
 * The light a surface gets from the room when it sees `seen` of the sky
 * and its neighbours hand some of theirs back: the fit of Jimenez and
 * others for surfaces of one albedo, which never makes it darker than the
 * sky alone would.
 */
export const BOUNCES = `
uniform float uAlbedo;
float withBounces(float seen) {
  float a = 2.0404 * uAlbedo - 0.3324;
  float b = 4.7951 * uAlbedo - 0.6417;
  float c = 2.7552 * uAlbedo + 0.6903;
  return max(seen, ((a * seen - b) * seen + c) * seen);
}
`;

/**
 * The light on the paper is worked out at each point of the grid, for the
 * face of it the reader sees, and spread between them. The lamp lights a
 * face by how squarely it meets it, and a face turned from it by what
 * comes through the paper; the room lights it by how much of the sky it
 * sees over the pages it stands on, with the light those pages hand back
 * restored as it is for the pages themselves. Where the leaf stands up
 * from the spine, its face and the page it faces see as much sky as each
 * other, and darken toward the spine together. Paper lying flat is lit to
 * exactly 1.
 */
export const SHEET_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform float uDepth;
uniform vec3 uLight;
uniform float uKeyShare;
uniform float uThrough;
varying float vLit;
varying vec2 vUv;
${PROJECTION}
${BOUNCES}
void main() {
  vec3 toEye = vec3(0.5 * uSize - aPosition.xy, uEye - aPosition.z);
  vec3 facing = dot(aNormal, toEye) >= 0.0 ? aNormal : -aNormal;
  float square = dot(facing, uLight) / uLight.z;
  float lamp = max(square, 0.0) + uThrough * max(-square, 0.0);
  float room = withBounces(0.5 + 0.5 * facing.z);
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
