// Made from the web paper turn's SheetFootprintFragment (packages/kit/src/driver/paper);
// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.
uniform FragmentInfo {
  float uHasFront;
  float uHasBack;
  float uSpine;
  float uSheet;
  float uShows;
  float uPart;
  vec4 uCurl;
  vec2 uSize;
  vec3 uPaper;
  float uKeyShare;
  float uHandedBack;
  vec2 uTexels;
};
uniform sampler2D uFront;
uniform sampler2D uBack;
layout(location = 2) in float vLit;
layout(location = 1) in float vHeight;
layout(location = 4) in vec2 vUv;
layout(location = 0) out vec4 paperColour;
#define gl_FragColor paperColour
vec2 footprintAlong;
float footprintReads;
void footprintOf(vec2 across, vec2 down) {
  float x = length(across * uTexels);
  float y = length(down * uTexels);
  footprintReads = clamp(ceil(max(x, y) / max(min(x, y), 1.0) - 0.01), 1.0, 8.0);
  footprintAlong = x > y ? across : down;
}
vec4 pageTexel(sampler2D page, vec2 at) {
  if (footprintReads < 1.5) return texture(page, at);
  vec4 sum = vec4(0.0);
  for (int i = 0; i < 8; i++) {
    if (float(i) >= footprintReads) break;
    sum += texture(page, at + footprintAlong * ((float(i) + 0.5) / footprintReads - 0.5));
  }
  return sum / footprintReads;
}
#define texture2D pageTexel
float withBounces(float seen) {
  return seen + (1.0 - seen) * uHandedBack;
}


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


vec3 printed(sampler2D page, vec2 at) {
  vec4 ink = texture2D(page, at);
  return ink.rgb + uPaper * (1.0 - ink.a);
}

void webMain() {
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
  
  float lit = vLit;
  if (uPart < -0.5 && gl_FrontFacing) lit -= lostInTheRoll(onFront * uSize, past);
  gl_FragColor = vec4(colour * min(lit, 1.0) * kept, kept);
}

void main() {
  footprintOf(dFdx(vUv) * vec2(uSheet, 1.0), dFdy(vUv) * vec2(uSheet, 1.0));
  webMain();
}
