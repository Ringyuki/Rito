/**
 * A WebGL2 framebuffer a spread is painted into, `width` by `height`
 * device pixels; `framebuffer` null is the context's own canvas. The
 * spread's top row lands on the framebuffer's top row, as it shows on a
 * canvas. Painting sets the viewport, scissor, blending and the program,
 * vertex array and textures it draws with, and leaves them so: whoever
 * draws with the context next sets its own.
 */
export interface ReaderGlTarget {
  readonly gl: WebGL2RenderingContext;
  readonly framebuffer: WebGLFramebuffer | null;
  readonly width: number;
  readonly height: number;
}
