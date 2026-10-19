import type { CoreReaderPrimitiveList } from '../core-contracts';
import { renderReaderPrimitivesToCanvas, type PrimitiveRenderOptions } from '../primitive-renderer';
import type { GlPenDevice, CanvasSurface } from './device';

interface CopyTarget {
  readonly width: number;
  readonly height: number;
}

/**
 * Paints a list with the canvas pen on the ground, as a canvas target
 * would have it, and copies it into the bound framebuffer pixel for pixel,
 * replacing what is there.
 */
export function paintThroughCanvas(
  device: GlPenDevice,
  list: CoreReaderPrimitiveList,
  target: CopyTarget,
  options: PrimitiveRenderOptions & {
    readonly ground?: string | undefined;
    readonly scale: number;
  },
): void {
  const surface = canvasSurface(device, target);
  const context = surface.context;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, target.width, target.height);
  if (options.ground) {
    context.fillStyle = options.ground;
    context.fillRect(0, 0, target.width, target.height);
  }
  if (options.scale !== 1) context.scale(options.scale, options.scale);
  renderReaderPrimitivesToCanvas(list, context, options);
  context.setTransform(1, 0, 0, 1, 0, 0);
  copyIntoFramebuffer(device, surface, target);
}

function canvasSurface(device: GlPenDevice, target: CopyTarget): CanvasSurface {
  let surface = device.canvas;
  if (surface === undefined) {
    const canvas = new OffscreenCanvas(target.width, target.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('The GPU pen could not get a 2D canvas to paint through');
    surface = { canvas, context, texture: undefined, textureWidth: 0, textureHeight: 0 };
    device.canvas = surface;
  }
  // Grown, never shrunk: a window being resized paints a new size every
  // frame, and a canvas is cleared and reallocated whenever it is sized.
  if (surface.canvas.width < target.width) surface.canvas.width = target.width;
  if (surface.canvas.height < target.height) surface.canvas.height = target.height;
  return surface;
}

function copyIntoFramebuffer(
  device: GlPenDevice,
  surface: CanvasSurface,
  target: CopyTarget,
): void {
  const gl = device.gl;
  if (
    surface.texture === undefined ||
    surface.textureWidth < target.width ||
    surface.textureHeight < target.height
  ) {
    if (surface.texture !== undefined) gl.deleteTexture(surface.texture);
    const texture = gl.createTexture();
    surface.textureWidth = Math.max(surface.textureWidth, surface.canvas.width);
    surface.textureHeight = Math.max(surface.textureHeight, surface.canvas.height);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, surface.textureWidth, surface.textureHeight);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    surface.texture = texture;
  }
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, surface.texture);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texSubImage2D(
    gl.TEXTURE_2D,
    0,
    0,
    0,
    target.width,
    target.height,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    surface.canvas,
  );
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
  gl.disable(gl.BLEND);
  gl.useProgram(device.image.program);
  gl.uniform2f(device.image.size, target.width, target.height);
  gl.bindBuffer(gl.ARRAY_BUFFER, device.instances);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, target.width, target.height, 0, 0, 1, 1, 1, 1]),
    gl.STREAM_DRAW,
  );
  gl.drawArraysInstanced(gl.TRIANGLES, 0, 6, 1);
  gl.enable(gl.BLEND);
}
