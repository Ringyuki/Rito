import type { TransitionPage } from '../effects';

/** The display's WebGL2 context, which the paper turn draws with. */
export type Gl = WebGL2RenderingContext;

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

/** A program handed to the GPU to compile and link, its outcome not yet asked for. */
export interface StartedProgram {
  readonly program: WebGLProgram;
  readonly shaders: readonly WebGLShader[];
  readonly attributes: readonly string[];
  readonly uniforms: readonly string[];
}

/**
 * Hands a program to the GPU without waiting for it. Asking whether a
 * shader compiled makes the page wait until it has; nothing is asked here.
 */
export function startProgram(
  gl: Gl,
  vertex: string,
  fragment: string,
  attributes: readonly string[],
  uniforms: readonly string[],
): StartedProgram {
  const program = gl.createProgram();
  const shaders = ([gl.VERTEX_SHADER, gl.FRAGMENT_SHADER] as const).map((kind) => {
    const shader = gl.createShader(kind);
    if (!shader) throw new Error('paper turn: the GPU gave no shader');
    gl.shaderSource(shader, kind === gl.VERTEX_SHADER ? vertex : fragment);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  return { program, shaders, attributes, uniforms };
}

/**
 * Whether the GPU has finished with a program, where it can say so without
 * being waited for; null where it cannot.
 */
export function programDone(gl: Gl, started: StartedProgram): boolean | null {
  const parallel = gl.getExtension('KHR_parallel_shader_compile') as {
    readonly COMPLETION_STATUS_KHR: number;
  } | null;
  if (!parallel) return null;
  return gl.getProgramParameter(started.program, parallel.COMPLETION_STATUS_KHR) === true;
}

/** The program ready to draw with. Waits for the GPU if it has not finished, and throws what it reports. */
export function finishProgram(gl: Gl, started: StartedProgram): Program {
  const { program } = started;
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const said = started.shaders
      .map((shader) => gl.getShaderInfoLog(shader))
      .concat(gl.getProgramInfoLog(program))
      .filter(Boolean);
    throw new Error(`paper turn: ${said.join(' ') || 'a program did not link'}`);
  }
  return {
    program,
    attributes: Object.fromEntries(
      started.attributes.map((name) => [name, gl.getAttribLocation(program, name)]),
    ),
    uniforms: Object.fromEntries(
      started.uniforms.map((name) => [name, gl.getUniformLocation(program, name)]),
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

/** A page as it was painted, kept as a texture for as long as anything shows it. */
export interface PageSnapshot {
  readonly texture: WebGLTexture;
}

/**
 * The textures kept of pages. A snapshot is of one painting of a page:
 * painted again, the page gets another, and the first lasts as long as a
 * leaf still in the air shows it.
 */
export interface PageTextures {
  /** The page as last painted, with its overlay over it, held until it is released. */
  take(page: TransitionPage): PageSnapshot;
  release(snapshot: PageSnapshot): void;
}

/** Snapshots nothing shows are kept for the turn that may want them next: this many. */
const KEPT_PAGES = 3;

interface Kept extends PageSnapshot {
  readonly source: WebGLTexture;
  readonly version: number;
  held: number;
  used: number;
}

export function createPageTextures(gl: Gl): PageTextures {
  /** The snapshot of each page as last painted, by the texture the page is shown in. */
  const latest = new Map<WebGLTexture, Kept>();
  const reading = gl.createFramebuffer();
  const drawing = gl.createFramebuffer();
  let uses = 0;
  const made = (page: TransitionPage, texture: WebGLTexture): Kept => {
    copyTurned(gl, page, texture, reading, drawing);
    return { texture, source: page.texture, version: page.version, held: 0, used: 0 };
  };
  return {
    take(page): PageSnapshot {
      uses += 1;
      let kept = latest.get(page.texture);
      if (kept?.version !== page.version) {
        // Nothing shows the older painting: its texture takes the new one.
        const texture = kept && kept.held === 0 ? kept.texture : gl.createTexture();
        kept = made(page, texture);
        latest.set(page.texture, kept);
      }
      kept.held += 1;
      kept.used = uses;
      return kept;
    },
    release(snapshot): void {
      const kept = snapshot as Kept;
      kept.held = Math.max(0, kept.held - 1);
      if (kept.held > 0) return;
      // A painting the page has since replaced is of no further use.
      if (latest.get(kept.source) !== kept) gl.deleteTexture(kept.texture);
      else dropUnshown(gl, latest);
    },
  };
}

/** Forgets the snapshots nothing shows, oldest first, beyond those kept for the next turn. */
function dropUnshown(gl: Gl, latest: Map<WebGLTexture, Kept>): void {
  const unshown = [...latest.values()].filter((kept) => kept.held === 0);
  unshown.sort((a, b) => a.used - b.used);
  for (const kept of unshown.slice(0, Math.max(0, unshown.length - KEPT_PAGES))) {
    gl.deleteTexture(kept.texture);
    latest.delete(kept.source);
  }
}

/**
 * Copies a page into `texture` turned over, its first row the page's top
 * as an image's is, which is how the sheets sample it; then the smaller
 * copies a tilted sheet is drawn from.
 */
function copyTurned(
  gl: Gl,
  page: TransitionPage,
  texture: WebGLTexture,
  reading: WebGLFramebuffer,
  drawing: WebGLFramebuffer,
): void {
  const { width, height } = page;
  const wasReading = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  const wasDrawing = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, reading);
  gl.framebufferTexture2D(
    gl.READ_FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    page.texture,
    0,
  );
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawing);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
  gl.blitFramebuffer(0, 0, width, height, 0, height, width, 0, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.framebufferTexture2D(gl.DRAW_FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, null, 0);
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, wasReading);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, wasDrawing);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  clampAndSmooth(gl);
  // A tilted sheet shrinks its page unevenly; smaller copies keep its print from shimmering.
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  const anisotropy = gl.getExtension('EXT_texture_filter_anisotropic');
  if (anisotropy) gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, 8);
}
