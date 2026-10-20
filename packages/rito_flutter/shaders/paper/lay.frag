// Made from the web paper turn's LayFragment (packages/kit/src/driver/paper);
// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.
uniform FragmentInfo {
  float uSpineAt;
  vec2 uBeside;
  float uStrength;
  vec2 uFlip;
};
uniform sampler2D uSource;
layout(location = 0) in vec2 vAt;
layout(location = 0) out vec4 paperColour;
#define gl_FragColor paperColour
// A texture another pass rendered, its rows as the backend stores them.
vec4 readTarget(sampler2D target, vec2 at) {
  return texture(target, vec2(at.x, uFlip.x + uFlip.y * at.y));
}
#define texture2D readTarget
vec2 onOwnPage(vec2 at) {
  return vec2(vAt.x > uSpineAt ? max(at.x, uBeside.y) : min(at.x, uBeside.x), at.y);
}

vec4 workedOut(vec2 at) {
  return texture2D(uSource, onOwnPage(at));
}

void main() {
  vec4 spread = workedOut(vAt);
  float dark = min(spread.a / max(spread.r, 0.004), 1.0);
  gl_FragColor = vec4(0.0, 0.0, 0.0, dark * uStrength);
}
