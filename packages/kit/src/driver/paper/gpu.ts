import {
  createPageTextures,
  finishProgram,
  programDone,
  startProgram,
  type Gl,
  type PageTextures,
  type Program,
  type StartedProgram,
} from './gl';
import type { SheetGrid } from './mesh';
import { sheetFragment, sheetVertex } from './shaders';
import { createShadowPass, type ShadowPass } from './shadow';
import { shadowPrograms, startShadowPrograms, type StartedShadow } from './shadow-programs';

/** The sampler of each face of the sheet, and the flag saying a page is printed on it. */
export const FACES = [
  ['uFront', 'uHasFront'],
  ['uBack', 'uHasBack'],
] as const;

const SHEET_UNIFORMS = ['uSize', 'uEye', 'uDepth', 'uSpine', 'uSheet', 'uPaper', 'uLight'].concat([
  'uKeyShare',
  'uThrough',
  'uHandedBack',
  'uLift',
  'uTurnedLift',
  'uShows',
  'uPart',
  'uCurl',
]);

/** What the GPU holds of one sheet in a frame. */
export interface SheetBuffers {
  readonly positions: WebGLBuffer;
  readonly normals: WebGLBuffer;
  /** The surface of a sheet lying still that the buffers hold, so it is not sent again. */
  holds: Float32Array | null;
}

/**
 * Where a frame is drawn before it is copied to the display: a colour and a
 * depth buffer, each drawn at several points a pixel when `samples` is more
 * than none.
 */
export interface FrameBuffers {
  readonly framebuffer: WebGLFramebuffer;
  readonly color: WebGLRenderbuffer;
  readonly depth: WebGLRenderbuffer;
  width: number;
  height: number;
}

/** Everything the paper turn holds on the GPU. */
export interface Gpu {
  readonly gl: Gl;
  readonly sheet: Program;
  /**
   * Whether the edge of a sheet in the air is softened where it is drawn,
   * which blends it with what lies beneath: the frame is not multisampled.
   */
  readonly softened: boolean;
  /** How many points a pixel the frame is drawn at; 0 draws it once. */
  readonly samples: number;
  /** Where frames are drawn; made at the first frame's size. */
  frame: FrameBuffers | null;
  readonly shadow: ShadowPass;
  readonly sheets: SheetBuffers[];
  readonly uvs: WebGLBuffer;
  readonly indices: WebGLBuffer;
  readonly textures: PageTextures;
  /** What a face with no page samples: nothing. */
  readonly bare: WebGLTexture;
  /** The grid the buffers are laid out for, and which it is. */
  mesh: SheetGrid | null;
  grid: string;
}

/** A GPU context with the paper turn's programs handed to it, their outcome not yet asked for. */
export interface StartedGpu {
  readonly gl: Gl;
  readonly softened: boolean;
  readonly samples: number;
  readonly sheet: StartedProgram;
  readonly shadow: StartedShadow;
}

/**
 * At two device pixels or more to a CSS pixel the steps along an edge are
 * too small to see, and drawing every pixel at several points to smooth
 * them costs a third of the frame; the edge is softened in the shader
 * there instead.
 */
const FINE = 2;

/**
 * Hands the display's context the programs to compile, without waiting
 * for them. Null where they cannot be made.
 */
export function startGpu(gl: Gl): StartedGpu | null {
  const scale = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  try {
    // Asked for before anything is compiled: with it the GPU compiles while the page goes on.
    gl.getExtension('KHR_parallel_shader_compile');
    const softened = scale >= FINE;
    const samples = softened ? 0 : Math.min(4, gl.getParameter(gl.MAX_SAMPLES) as number);
    const uniforms = [...SHEET_UNIFORMS, ...FACES.flat()];
    const sheet = startProgram(
      gl,
      sheetVertex(softened),
      sheetFragment(softened, softened),
      ['aPosition', 'aNormal', 'aUv'],
      uniforms,
    );
    const shadow = startShadowPrograms(gl);
    // Sent now: a context nothing is drawn with keeps what it is told until it is asked something.
    gl.flush();
    return { gl, softened, samples, sheet, shadow };
  } catch (error) {
    report(error);
    return null;
  }
}

/** Whether the GPU has finished with every program; true where it does not say without being waited for. */
export function gpuDone(started: StartedGpu): boolean {
  const { gl, sheet, shadow } = started;
  return [sheet, ...shadowPrograms(shadow)].every((program) => programDone(gl, program) !== false);
}

/** The GPU set up to draw sheets and their shadows; waits for it if it has not finished. */
export function finishGpu(started: StartedGpu): Gpu | null {
  const { gl, softened, samples } = started;
  try {
    return {
      gl,
      softened,
      samples,
      frame: null,
      sheet: finishProgram(gl, started.sheet),
      shadow: createShadowPass(gl, started.shadow),
      sheets: [],
      uvs: gl.createBuffer(),
      indices: gl.createBuffer(),
      textures: createPageTextures(gl),
      bare: bareTexture(gl),
      mesh: null,
      grid: '',
    };
  } catch (error) {
    report(error);
    return null;
  }
}

function report(error: unknown): void {
  console.error('[rito] the paper turn cannot use the GPU; turns fall back to a plain one', error);
}

function bareTexture(gl: Gl): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const clear = new Uint8Array([0, 0, 0, 0]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, clear);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  return texture;
}

/** The buffers a frame `width` by `height` is drawn in: those kept, sized for it. */
export function frameBuffersFor(gpu: Gpu, width: number, height: number): FrameBuffers {
  const { gl } = gpu;
  const kept = gpu.frame;
  if (kept && kept.width === width && kept.height === height) return kept;
  const buffers = kept ?? {
    framebuffer: gl.createFramebuffer(),
    color: gl.createRenderbuffer(),
    depth: gl.createRenderbuffer(),
    width,
    height,
  };
  buffers.width = width;
  buffers.height = height;
  gl.bindRenderbuffer(gl.RENDERBUFFER, buffers.color);
  gl.renderbufferStorageMultisample(gl.RENDERBUFFER, gpu.samples, gl.RGBA8, width, height);
  gl.bindRenderbuffer(gl.RENDERBUFFER, buffers.depth);
  gl.renderbufferStorageMultisample(
    gl.RENDERBUFFER,
    gpu.samples,
    gl.DEPTH_COMPONENT24,
    width,
    height,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, buffers.framebuffer);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, buffers.color);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, buffers.depth);
  gpu.frame = buffers;
  return buffers;
}
