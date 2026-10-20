// Made from the web paper turn's SheetFragment (packages/kit/src/driver/paper);
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
};
uniform sampler2D uFront;
uniform sampler2D uBack;
layout(location = 2) in float vLit;
layout(location = 1) in float vHeight;
layout(location = 4) in vec2 vUv;
layout(location = 0) out vec4 paperColour;
#define gl_FragColor paperColour
bool paperDropped = false;
#define texture2D texture
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
  if (uPart > 0.5 && past > 0.0) paperDropped = true;
  if (uPart < -0.5 && past <= 0.0) paperDropped = true;
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
  webMain();
  if (paperDropped) discard;
}
