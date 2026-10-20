uniform sampler2D uSource;
layout(location = 0) in vec2 vAt;
layout(location = 0) out vec4 apart;
void main() {
  apart = vec4(abs(texture(uSource, vAt).r - vAt.y), 0.0, 0.0, 1.0);
}
