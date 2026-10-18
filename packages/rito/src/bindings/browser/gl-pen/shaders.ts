/**
 * Every draw is an instanced quad: `rect` is where it lands in device
 * pixels (y down, as on a canvas), `cell` the texel its top-left corner
 * reads, `color` its ink in 0..1. Quads sit on whole pixels, so every
 * fragment reads exactly one texel.
 */
export const QUAD_VERTEX = `#version 300 es
layout(location = 0) in vec2 corner;
layout(location = 1) in vec4 rect;
layout(location = 2) in vec2 cell;
layout(location = 3) in vec4 color;
uniform vec2 size;
out vec2 texel;
out vec4 ink;
void main() {
  vec2 point = rect.xy + corner * rect.zw;
  texel = cell + corner * rect.zw;
  ink = color;
  gl_Position = vec4(point.x / size.x * 2.0 - 1.0, 1.0 - point.y / size.y * 2.0, 0.0, 1.0);
}`;

/** A fill in its ink, premultiplied. */
export const SOLID_FRAGMENT = `#version 300 es
precision highp float;
in vec2 texel;
in vec4 ink;
out vec4 fragment;
void main() {
  fragment = vec4(ink.rgb * ink.a, ink.a);
}`;

/**
 * A glyph cell's coverage times the run's ink. The cell was rasterized in
 * that ink, so its coverage is the canvas's own for that ink; the colour
 * is applied here, where it is quantized once, as the canvas does.
 */
export const GLYPH_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D atlas;
in vec2 texel;
in vec4 ink;
out vec4 fragment;
void main() {
  float coverage = texelFetch(atlas, ivec2(texel), 0).a;
  fragment = vec4(ink.rgb * coverage, coverage);
}`;

/** A premultiplied image copied texel for pixel. */
export const IMAGE_FRAGMENT = `#version 300 es
precision highp float;
uniform sampler2D image;
in vec2 texel;
in vec4 ink;
out vec4 fragment;
void main() {
  fragment = texelFetch(image, ivec2(texel), 0);
}`;
