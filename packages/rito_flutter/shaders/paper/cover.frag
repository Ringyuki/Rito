// Made from the web paper turn's CoverFragment (packages/kit/src/driver/paper);
// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.
layout(location = 3) in float vPast;
layout(location = 0) out vec4 paperColour;
#define gl_FragColor paperColour
#define texture2D texture
void main() {
  if (vPast <= 0.0) discard;
  gl_FragColor = vec4(1.0);
}
