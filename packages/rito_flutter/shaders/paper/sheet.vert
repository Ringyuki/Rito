// Made from the web paper turn's SheetVertex (packages/kit/src/driver/paper);
// regenerate with RITO_EMIT_SHADERS=1 pnpm --filter @ritojs/kit test paper-flutter-shaders.
uniform VertexInfo {
  float uDepth;
  float uLift;
  float uTurnedLift;
  vec3 uLight;
  float uKeyShare;
  float uThrough;
  vec2 uSize;
  float uEye;
  float uHandedBack;
};
in vec3 aPosition;
in vec3 aNormal;
in vec2 aUv;
layout(location = 2) out float vLit;
layout(location = 1) out float vHeight;
layout(location = 4) out vec2 vUv;
vec4 project(vec3 at, float depth) {
  float w = (uEye - at.z) / uEye;
  vec2 centred = (at.xy - 0.5 * uSize) / (0.5 * uSize);
  return vec4(centred.x, -centred.y, depth * w, w);
}


float withBounces(float seen) {
  return seen + (1.0 - seen) * uHandedBack;
}

void webMain() {
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

void main() {
  webMain();
  // GL's clip depth runs -w..w, Impeller's 0..w.
  gl_Position.z = 0.5 * (gl_Position.z + gl_Position.w);
}
