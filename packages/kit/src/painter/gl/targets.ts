/**
 * A texture with a framebuffer drawing into it, `width` by `height` device
 * pixels. Its rows run as a GL framebuffer's do: the last row is the top
 * of what it shows.
 */
export interface GlPageTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  width: number;
  height: number;
}

export function createPageTarget(
  gl: WebGL2RenderingContext,
  width: number,
  height: number,
): GlPageTarget {
  const target = {
    texture: gl.createTexture(),
    framebuffer: gl.createFramebuffer(),
    width: 0,
    height: 0,
  };
  sizePageTarget(gl, target, width, height);
  return target;
}

/** Gives a target a new size; what it held is gone. */
export function sizePageTarget(
  gl: WebGL2RenderingContext,
  target: GlPageTarget,
  width: number,
  height: number,
): void {
  target.width = Math.max(1, width);
  target.height = Math.max(1, height);
  gl.bindTexture(gl.TEXTURE_2D, target.texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    target.width,
    target.height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  smoothAndClamp(gl);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, target.texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
}

export function deletePageTarget(gl: WebGL2RenderingContext, target: GlPageTarget): void {
  gl.deleteFramebuffer(target.framebuffer);
  gl.deleteTexture(target.texture);
}

/**
 * Copies a 2D canvas into a texture, premultiplied and turned so its rows
 * run as a framebuffer's do.
 */
export function uploadCanvas(
  gl: WebGL2RenderingContext,
  texture: WebGLTexture,
  canvas: OffscreenCanvas,
): void {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  smoothAndClamp(gl);
}

function smoothAndClamp(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}
