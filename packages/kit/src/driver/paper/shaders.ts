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
 * The light a surface gets from the room when it sees `seen` of the sky:
 * that, and what the paper hiding the rest hands back of it
 * (`uHandedBack`). Seeing all the sky, it is lit to exactly 1.
 */
export const BOUNCES = `
uniform float uHandedBack;
float withBounces(float seen) {
  return seen + (1.0 - seen) * uHandedBack;
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
/**
 * What turns a shader written for the first generation of WebGL into one
 * for the second, which alone can ask how fast a surface crosses a pixel
 * without an extension.
 */
const SECOND_GENERATION_VERTEX = `#version 300 es
#define attribute in
#define varying out
`;
const SECOND_GENERATION_FRAGMENT = `#version 300 es
precision highp float;
#define varying in
#define texture2D texture
out vec4 paperColour;
#define gl_FragColor paperColour
`;

/** The sheet's vertex shader, for the second generation of WebGL when `second`. */
export function sheetVertex(second: boolean): string {
  return (second ? SECOND_GENERATION_VERTEX : '') + SHEET_VERTEX;
}

const SHEET_VERTEX = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUv;
uniform float uDepth;
uniform float uLift;
uniform float uTurnedLift;
uniform vec3 uLight;
uniform float uKeyShare;
uniform float uThrough;
varying float vLit;
varying float vHeight;
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
  vHeight = aPosition.z;
  // Sheets lying on each other are at one height; the lift tells the depth test which is on top.
  // Paper turned over lies the other way up, and so in the other order: it is lifted by its own amount.
  float turned = smoothstep(0.0, 0.2, 0.5 - 0.5 * aNormal.z);
  gl_Position = project(aPosition, -(aPosition.z + uLift + uTurnedLift * turned) / uDepth);
}
`;

/**
 * The light of the room on the face a curled page is rolled in on: the one
 * it shows where its paper ends before it is half way round the roll. That
 * face looks into the roll, and of the sky sees what shows between the page
 * it rose from and where its own paper ends, round the roll or lying on top
 * of it. At the line it leaves the pages at that is what the page beside
 * it sees too, so the paper is lit alike on both sides of the line, as one
 * sheet. `uCurl` is the direction across the page it is rolled back from
 * (xy), where that line lies along it (z) and the radius of the roll (w).
 */
const IN_THE_ROLL = `
// How much less of the room's light a point of the sheet's front gets, past beyond the line,
// than a face leaning as it does would get under an open sky.
float lostInTheRoll(vec2 onSheet, float past) {
  float r = uCurl.w;
  if (past <= 0.0 || past >= 3.1415927 * r) return 0.0;
  vec2 d = uCurl.xy;
  // How far the paper goes on from here before the page ends.
  float reach = (uSize.x - onSheet.x) / max(d.x, 0.0001);
  if (d.y > 0.0001) reach = min(reach, (uSize.y - onSheet.y) / d.y);
  if (d.y < -0.0001) reach = min(reach, -onSheet.y / d.y);
  float paper = past + reach;
  // How far round the roll the point is, and the angle from its face to where the paper ends:
  // round the roll, or over the edge of what lies on top.
  float here = past / r;
  float over = paper - 3.1415927 * r;
  float toEnd = 0.5 * (min(3.1415927, paper / r) - here);
  if (over > 0.0) {
    vec2 at = r * vec2(sin(here), 1.0 - cos(here));
    toEnd = atan(2.0 * r - at.y, -over - at.x) - here;
  }
  float open = 0.5 + 0.5 * cos(here);
  float seen = 0.5 * (cos(toEnd) + cos(here));
  return (1.0 - uKeyShare) * (withBounces(open) - withBounces(seen));
}
`;

/** Fades a sheet's unbound edges out over the last pixel of it, the more the higher it stands. */
const SOFT_EDGE = `
  vec2 pixel = max(fwidth(vUv), vec2(1e-6));
  float inside = min(min((1.0 - vUv.x) / pixel.x, vUv.y / pixel.y), (1.0 - vUv.y) / pixel.y);
  kept = mix(1.0, clamp(inside, 0.0, 1.0), smoothstep(0.5, 3.0, vHeight));
`;

/**
 * Both faces of the leaf. The front shows the spread it is lifted from,
 * the back the spread it lands on, mirrored; a back with nothing printed
 * on it is bare paper, the colour of the page's own margin, with the front
 * showing through, by `uShows`. Paper lying flat is exactly the page's own
 * colours.
 *
 * A page curled over is drawn in two parts, so that the shadows can be laid
 * between them: `uPart` above zero draws only what of it still lies on the
 * pages, below zero only what has left them. The two part at the line the
 * paper leaves the page at, told by `uCurl` as a direction across the page
 * (xy) and where the line lies along it (z); which side a point of the
 * sheet is on is told from where it is on the sheet, not from how high it
 * has risen, so the parts meet along a straight line. The part that has left
 * them is lit on its front by what it sees from inside the roll.
 *
 * `softened` is for a canvas that is not multisampled: the three edges of
 * a sheet in the air that are not bound are faded out over the last pixel
 * of it, by how fast its surface crosses the pixels there. A sheet lying on
 * the page ends where the page does and is not faded at all. Asking how
 * fast is part of the second generation of WebGL (`second`) and an
 * extension of the first.
 */
export function sheetFragment(softened: boolean, second: boolean): string {
  const first = softened && !second ? '#extension GL_OES_standard_derivatives : enable\n' : '';
  return `${second ? SECOND_GENERATION_FRAGMENT : first}
precision highp float;
uniform sampler2D uFront;
uniform sampler2D uBack;
uniform float uHasFront;
uniform float uHasBack;
uniform float uSpine;
uniform float uSheet;
uniform float uShows;
uniform float uPart;
uniform vec4 uCurl;
uniform vec2 uSize;
uniform vec3 uPaper;
uniform float uKeyShare;
varying float vLit;
varying float vHeight;
varying vec2 vUv;
${BOUNCES}
${IN_THE_ROLL}

vec3 printed(sampler2D page, vec2 at) {
  vec4 ink = texture2D(page, at);
  return ink.rgb + uPaper * (1.0 - ink.a);
}

void main() {
  vec2 onFront = vec2(uSpine + vUv.x * uSheet, vUv.y);
  float past = dot(onFront * uSize, uCurl.xy) - uCurl.z;
  if (uPart > 0.5 && past > 0.0) discard;
  if (uPart < -0.5 && past <= 0.0) discard;
  vec3 front = uHasFront > 0.5 ? printed(uFront, onFront) : uPaper;
  vec3 colour = front;
  if (!gl_FrontFacing) {
    vec2 onBack = vec2(uSpine - vUv.x * uSheet, vUv.y);
    vec3 bare = uHasFront > 0.5 ? printed(uFront, vec2(uSpine + 0.985 * uSheet, 0.012)) : uPaper;
    colour = uHasBack > 0.5 && onBack.x >= 0.0
      ? printed(uBack, onBack)
      : mix(bare, front, uShows);
  }
  float kept = 1.0;
  ${softened ? SOFT_EDGE : ''}
  float lit = vLit;
  if (uPart < -0.5 && gl_FrontFacing) lit -= lostInTheRoll(onFront * uSize, past);
  gl_FragColor = vec4(colour * min(lit, 1.0) * kept, kept);
}
`;
}
