// Made from the web paper turn's CoverVertex (packages/kit/src/driver/paper);
// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.
uniform VertexInfo {
  float uSpine;
  vec3 uLine;
  vec2 uSize;
  float uEye;
};
in vec3 aPosition;
in vec2 aUv;
layout(location = 3) out float vPast;
vec4 project(vec3 at, float depth) {
  float w = (uEye - at.z) / uEye;
  vec2 centred = (at.xy - 0.5 * uSize) / (0.5 * uSize);
  return vec4(centred.x, -centred.y, depth * w, w);
}

void webMain() {
  vec2 onSheet = vec2(uSpine + aUv.x * (uSize.x - uSpine), aUv.y * uSize.y);
  vPast = dot(onSheet, uLine.xy) - uLine.z;
  gl_Position = project(aPosition, 0.0);
}

void main() {
  webMain();
  // GL's clip depth runs -w..w, Impeller's 0..w.
  gl_Position.z = 0.5 * (gl_Position.z + gl_Position.w);
}
