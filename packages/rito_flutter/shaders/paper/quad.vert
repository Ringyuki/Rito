// Made from the web paper turn's QuadVertex (packages/kit/src/driver/paper);
// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.
in vec2 aCorner;
layout(location = 0) out vec2 vAt;
void webMain() {
  vAt = aCorner * 0.5 + 0.5;
  gl_Position = vec4(aCorner, 0.0, 1.0);
}

void main() {
  webMain();
  // GL's clip depth runs -w..w, Impeller's 0..w.
  gl_Position.z = 0.5 * (gl_Position.z + gl_Position.w);
}
