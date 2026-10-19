layout(location = 0) in vec2 vAt;
layout(location = 0) out vec4 written;
void main() {
  written = vec4(vAt.y, 0.0, 0.0, 1.0);
}
