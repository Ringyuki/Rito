// Made from the web paper turn's CastFragment (packages/kit/src/driver/paper);
// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.
uniform FragmentInfo {
  float uTallest;
  float uPixel;
};
layout(location = 1) in float vHeight;
layout(location = 0) out vec4 paperColour;
#define gl_FragColor paperColour
#define texture2D texture
void main() {
  gl_FragColor = vec4(vHeight / uTallest, 0.0, 0.0, smoothstep(0.0, 1.5 * uPixel, vHeight));
}
