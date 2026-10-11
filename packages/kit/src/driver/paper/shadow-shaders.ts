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
 * leaf is taken as a strip running the height of the page, and what it
 * hides from a point is everything between the horizon on its side and
 * the highest the point sees of it: by the spine that is the slope the
 * leaf leaves it at, far off it is the leaf's outer edge. The light the
 * white pages hand back and forth is restored by the fit Jimenez and
 * others give for surfaces of one albedo.
 *
 * And by the spine, the leaf's own shade. The pages of a book are bound
 * together: the page beside a standing leaf rises to meet it at the spine
 * and is lit there as the foot of the leaf is, so the leaf's shade runs on
 * across the spine and fades into the page instead of stopping at a line.
 */
export const OCCLUSION_FRAGMENT = `
precision highp float;
uniform sampler2D uBlockers;
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
  float leftmost = uSpine;
  float rightmost = uSpine;
  // The highest the point sees of the leaf, looking left and looking right.
  float lowestLeft = 3.1415927;
  float highestRight = 0.0;
  for (int column = 0; column < 4; column++) {
    vec3 paper = vec3(0.0);
    for (int row = 0; row < 8; row++) {
      paper += uProfile[row * 4 + column] * clamp(1.0 - abs(along - float(row)), 0.0, 1.0);
    }
    leftmost = min(leftmost, paper.x);
    rightmost = max(rightmost, paper.x);
    float toPaper = atan(max(paper.z, 0.0), paper.x - point.x);
    lowestLeft = min(lowestLeft, toPaper);
    highestRight = max(highestRight, toPaper);
  }
  // Under the leaf the page is out of sight: no sky to hide.
  if (point.x > leftmost && point.x < rightmost) return -1.0;
  return point.x >= rightmost ? 0.5 * (1.0 + cos(lowestLeft)) : 0.5 * (1.0 - cos(highestRight));
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
  vec2 point = vec2(vAt.x, 1.0 - vAt.y) * uSize;
  float turned = TURN * fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float sky = hiddenSky(point);
  // Under the leaf the page is out of sight; only the shade by the spine is kept there, so
  // that what is worked out for the hidden page does not spread onto the page beside it.
  if (sky < 0.0) {
    gl_FragColor = vec4(byTheSpine(point));
    return;
  }
  float lamp = 1.0 - (1.0 - uThrough) * hiddenLamp(vAt, turned);
  float room = withBounces(1.0 - sky);
  float shadowed = 1.0 - (uKeyShare * lamp + (1.0 - uKeyShare) * room);
  gl_FragColor = vec4(max(shadowed, byTheSpine(point)));
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
