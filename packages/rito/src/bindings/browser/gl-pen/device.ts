import { GlyphAtlas } from './atlas';
import { GLYPH_FRAGMENT, IMAGE_FRAGMENT, QUAD_VERTEX, SOLID_FRAGMENT } from './shaders';

export interface PenProgram {
  readonly program: WebGLProgram;
  readonly size: WebGLUniformLocation | null;
}

/** The canvas the canvas pen paints a list on, and the texture it is copied through. */
export interface CanvasSurface {
  readonly canvas: OffscreenCanvas;
  readonly context: OffscreenCanvasRenderingContext2D;
  texture: WebGLTexture | undefined;
  textureWidth: number;
  textureHeight: number;
}

/** What the GPU pen keeps in one WebGL2 context. */
export interface GlPenDevice {
  readonly gl: WebGL2RenderingContext;
  readonly solid: PenProgram;
  readonly glyph: PenProgram;
  readonly image: PenProgram;
  readonly vertexArray: WebGLVertexArrayObject;
  readonly instances: WebGLBuffer;
  readonly atlas: GlyphAtlas;
  canvas: CanvasSurface | undefined;
}

/** Floats per instance: rect (4), cell (2), colour (4). */
export const INSTANCE_FLOATS = 10;

const devices = new WeakMap<WebGL2RenderingContext, GlPenDevice>();

/**
 * The pen's resources in `gl`, made on first use. A lost context drops
 * them; the first paint after the context is restored makes them again.
 */
export function penDevice(gl: WebGL2RenderingContext): GlPenDevice | undefined {
  if (gl.isContextLost()) return undefined;
  let device = devices.get(gl);
  if (device === undefined) {
    device = createDevice(gl);
    devices.set(gl, device);
    gl.canvas.addEventListener('webglcontextlost', () => devices.delete(gl), { once: true });
  }
  return device;
}

function createDevice(gl: WebGL2RenderingContext): GlPenDevice {
  const vertexArray = gl.createVertexArray();
  const corners = gl.createBuffer();
  const instances = gl.createBuffer();
  gl.bindVertexArray(vertexArray);
  gl.bindBuffer(gl.ARRAY_BUFFER, corners);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([0, 0, 1, 0, 0, 1, 1, 0, 1, 1, 0, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, instances);
  const stride = INSTANCE_FLOATS * 4;
  for (const [location, components, offset] of [
    [1, 4, 0],
    [2, 2, 16],
    [3, 4, 24],
  ] as const) {
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, components, gl.FLOAT, false, stride, offset);
    gl.vertexAttribDivisor(location, 1);
  }
  gl.bindVertexArray(null);
  return {
    gl,
    solid: program(gl, SOLID_FRAGMENT),
    glyph: program(gl, GLYPH_FRAGMENT),
    image: program(gl, IMAGE_FRAGMENT),
    vertexArray,
    instances,
    atlas: new GlyphAtlas(gl),
    canvas: undefined,
  };
}

function program(gl: WebGL2RenderingContext, fragment: string): PenProgram {
  const linked = gl.createProgram();
  for (const [type, source] of [
    [gl.VERTEX_SHADER, QUAD_VERTEX],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(type);
    if (!shader) throw new Error('The GPU pen could not create a shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(linked, shader);
  }
  gl.linkProgram(linked);
  if (!gl.getProgramParameter(linked, gl.LINK_STATUS)) {
    throw new Error(`The GPU pen's program did not link: ${gl.getProgramInfoLog(linked) ?? ''}`);
  }
  return { program: linked, size: gl.getUniformLocation(linked, 'size') };
}
