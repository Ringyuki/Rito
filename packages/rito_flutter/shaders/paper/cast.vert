// Made from the web paper turn's CastVertex (packages/kit/src/driver/paper);
// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.
uniform VertexInfo {
  vec2 uCast;
  vec2 uSize;
  float uEye;
};
in vec3 aPosition;
layout(location = 1) out float vHeight;
vec4 project(vec3 at, float depth) {
  float w = (uEye - at.z) / uEye;
  vec2 centred = (at.xy - 0.5 * uSize) / (0.5 * uSize);
  return vec4(centred.x, -centred.y, depth * w, w);
}

void webMain() {
  float height = max(aPosition.z, 0.0);
  vHeight = height;
  gl_Position = project(vec3(aPosition.xy + uCast * height, 0.0), 0.0);
}

void main() {
  webMain();
  // GL's clip depth runs -w..w, Impeller's 0..w.
  gl_Position.z = 0.5 * (gl_Position.z + gl_Position.w);
}
