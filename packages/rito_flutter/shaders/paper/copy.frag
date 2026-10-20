uniform FragmentInfo {
  vec2 uFlip;
};
uniform sampler2D uSource;
layout(location = 0) in vec2 vAt;
layout(location = 0) out vec4 copied;
void main() {
  copied = texture(uSource, vec2(vAt.x, uFlip.x + uFlip.y * vAt.y));
}
