import type { TransitionPage } from '../effects';

/** A WebGL context of either generation; the paper turn uses what both have. */
export type Gl = WebGLRenderingContext | WebGL2RenderingContext;

export type PaperCanvas = OffscreenCanvas | HTMLCanvasElement;

/** A compiled program with the locations of everything it names. */
export interface Program {
  readonly program: WebGLProgram;
  readonly attributes: Readonly<Record<string, number>>;
  readonly uniforms: Readonly<Record<string, WebGLUniformLocation | null>>;
}

/** A texture to render into. */
export interface RenderTarget {
  readonly texture: WebGLTexture;
  readonly framebuffer: WebGLFramebuffer;
  readonly width: number;
  readonly height: number;
}

/** A canvas with a WebGL context, or null where there is none to be had. */
export function createGlCanvas(): { canvas: PaperCanvas; gl: Gl } | null {
  const canvas = blankCanvas(1, 1);
  if (!canvas) return null;
  const options = { alpha: true, antialias: true, depth: true, premultipliedAlpha: true };
  for (const kind of ['webgl2', 'webgl'] as const) {
    const gl = contextOf(canvas, kind, options);
    if (gl) return { canvas, gl };
  }
  return null;
}

function contextOf(canvas: PaperCanvas, kind: string, options: object): Gl | null {
  try {
    const context: unknown = canvas.getContext(kind as 'webgl', options);
    return isGl(context) ? context : null;
  } catch {
    return null;
  }
}

export function blankCanvas(width: number, height: number): PaperCanvas | null {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(width, height);
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function isGl(context: unknown): context is Gl {
  return (
    typeof context === 'object' &&
    context !== null &&
    typeof (context as Partial<Gl>).createShader === 'function' &&
    typeof (context as Partial<Gl>).drawElements === 'function'
  );
}

export function isSecondGeneration(gl: Gl): gl is WebGL2RenderingContext {
  return typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
}

export function createProgram(
  gl: Gl,
  vertex: string,
  fragment: string,
  attributes: readonly string[],
  uniforms: readonly string[],
): Program {
  const program = gl.createProgram();
  for (const [kind, source] of [
    [gl.VERTEX_SHADER, vertex],
    [gl.FRAGMENT_SHADER, fragment],
  ] as const) {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('paper turn: the GPU gave no shader');
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
      throw new Error(`paper turn: ${gl.getShaderInfoLog(shader) ?? 'a shader did not compile'}`);
    }
    gl.attachShader(program, shader);
  }
  gl.linkProgram(program);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    throw new Error(`paper turn: ${gl.getProgramInfoLog(program) ?? 'a program did not link'}`);
  }
  return {
    program,
    attributes: Object.fromEntries(
      attributes.map((name) => [name, gl.getAttribLocation(program, name)]),
    ),
    uniforms: Object.fromEntries(
      uniforms.map((name) => [name, gl.getUniformLocation(program, name)]),
    ),
  };
}

export function createRenderTarget(gl: Gl, width: number, height: number): RenderTarget {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  clampAndSmooth(gl);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { texture, framebuffer, width, height };
}

/** Points an attribute of `program` at `buffer`, `size` floats a vertex. */
export function attribute(
  gl: Gl,
  program: Program,
  name: string,
  buffer: WebGLBuffer,
  size: number,
): void {
  const location = program.attributes[name] ?? -1;
  if (location < 0) return;
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(location);
  gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
}

function clampAndSmooth(gl: Gl): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

/** The textures kept of pages, each good for the version of the page it was made from. */
export interface PageTextures {
  /** The texture of a page as last painted, with its overlay over it. */
  of(page: TransitionPage): WebGLTexture;
}

interface KeptTexture {
  readonly texture: WebGLTexture;
  version: number;
  used: number;
}

/** A reader turns among three spreads: the one on screen and its neighbours. */
const KEPT_PAGES = 3;

export function createPageTextures(gl: Gl): PageTextures {
  const kept = new Map<object, KeptTexture>();
  const limit = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
  let scratch: PaperCanvas | null = null;
  let uses = 0;
  return {
    of(page): WebGLTexture {
      uses += 1;
      let entry = kept.get(page.content);
      if (!entry) {
        entry = { texture: gl.createTexture(), version: Number.NaN, used: uses };
        kept.set(page.content, entry);
      }
      entry.used = uses;
      gl.bindTexture(gl.TEXTURE_2D, entry.texture);
      if (entry.version !== page.version) {
        scratch ??= blankCanvas(1, 1);
        upload(gl, flattened(page, limit, scratch));
        entry.version = page.version;
      }
      if (kept.size > KEPT_PAGES) dropOldest(gl, kept);
      return entry.texture;
    },
  };
}

/** The page with its overlay over it, no larger than a texture may be. */
function flattened(
  page: TransitionPage,
  limit: number,
  scratch: PaperCanvas | null,
): TexImageSource {
  const { width, height } = sizeOf(page.content);
  const scale = Math.min(1, limit / Math.max(width, height, 1));
  if (!page.overlay && scale === 1) return page.content as TexImageSource;
  const context = scratch?.getContext('2d') as CanvasRenderingContext2D | null;
  if (!scratch || !context) return page.content as TexImageSource;
  scratch.width = Math.max(1, Math.round(width * scale));
  scratch.height = Math.max(1, Math.round(height * scale));
  context.drawImage(page.content, 0, 0, scratch.width, scratch.height);
  if (page.overlay) context.drawImage(page.overlay, 0, 0, scratch.width, scratch.height);
  return scratch;
}

function upload(gl: Gl, source: TexImageSource): void {
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
  clampAndSmooth(gl);
  // A tilted sheet shrinks its page unevenly; smaller copies keep its print from shimmering.
  if (!isSecondGeneration(gl)) return;
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, 8);
}

function dropOldest(gl: Gl, kept: Map<object, KeptTexture>): void {
  let oldest: object | null = null;
  let used = Infinity;
  for (const [key, entry] of kept) {
    if (entry.used < used) {
      used = entry.used;
      oldest = key;
    }
  }
  if (!oldest) return;
  const entry = kept.get(oldest);
  if (entry) gl.deleteTexture(entry.texture);
  kept.delete(oldest);
}

function sizeOf(source: CanvasImageSource): { width: number; height: number } {
  const sized = source as { width?: unknown; height?: unknown };
  return {
    width: typeof sized.width === 'number' ? sized.width : 1,
    height: typeof sized.height === 'number' ? sized.height : 1,
  };
}
