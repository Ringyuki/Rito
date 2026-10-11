import {
  createGlCanvas,
  createPageTextures,
  finishProgram,
  isSecondGeneration,
  programDone,
  startProgram,
  type Gl,
  type PageTextures,
  type PaperCanvas,
  type Program,
  type StartedProgram,
} from './gl';
import type { SheetGrid } from './mesh';
import { sheetFragment, sheetVertex } from './shaders';
import {
  createShadowPass,
  startShadowPrograms,
  type ShadowPass,
  type StartedShadow,
} from './shadow';

/** The sampler of each face of the sheet, and the flag saying a page is printed on it. */
export const FACES = [
  ['uFront', 'uHasFront'],
  ['uBack', 'uHasBack'],
] as const;

const SHEET_UNIFORMS = ['uSize', 'uEye', 'uDepth', 'uSpine', 'uSheet', 'uPaper', 'uLight'].concat([
  'uKeyShare',
  'uThrough',
  'uAlbedo',
  'uLift',
]);

/** What the GPU holds of one sheet in a frame. */
export interface SheetBuffers {
  readonly positions: WebGLBuffer;
  readonly normals: WebGLBuffer;
}

/** Everything the paper turn holds on the GPU. */
export interface Gpu {
  readonly canvas: PaperCanvas;
  readonly gl: Gl;
  readonly sheet: Program;
  /**
   * Whether the edge of a sheet in the air is softened where it is drawn,
   * which blends it with what lies beneath: the canvas is not multisampled.
   */
  readonly softened: boolean;
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
  readonly canvas: PaperCanvas;
  readonly gl: Gl;
  readonly softened: boolean;
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
 * Makes the GPU context and hands it the programs to compile, without
 * waiting for them. Null where there is no GPU to be had.
 */
export function startGpu(): StartedGpu | null {
  const scale = (globalThis as { devicePixelRatio?: number }).devicePixelRatio ?? 1;
  const made = createGlCanvas(scale < FINE);
  if (!made) return null;
  const { canvas, gl } = made;
  try {
    // Asked for before anything is compiled: with it the GPU compiles while the page goes on.
    gl.getExtension('KHR_parallel_shader_compile');
    // Softening an edge needs to know how fast a sheet's surface crosses a pixel.
    const second = isSecondGeneration(gl);
    const softened =
      scale >= FINE && (second || gl.getExtension('OES_standard_derivatives') !== null);
    const uniforms = [...SHEET_UNIFORMS, ...FACES.flat()];
    const sheet = startProgram(
      gl,
      sheetVertex(softened && second),
      sheetFragment(softened, softened && second),
      ['aPosition', 'aNormal', 'aUv'],
      uniforms,
    );
    const shadow = startShadowPrograms(gl);
    // Sent now: a context nothing is drawn with keeps what it is told until it is asked something.
    gl.flush();
    return { canvas, gl, softened, sheet, shadow };
  } catch (error) {
    report(error);
    return null;
  }
}

/** Whether the GPU has finished with every program; true where it does not say without being waited for. */
export function gpuDone(started: StartedGpu): boolean {
  const { gl, sheet, shadow } = started;
  return [sheet, shadow.cast, shadow.occlusion, shadow.blur, shadow.lay].every(
    (program) => programDone(gl, program) !== false,
  );
}

/** The GPU set up to draw sheets and their shadows; waits for it if it has not finished. */
export function finishGpu(started: StartedGpu): Gpu | null {
  const { canvas, gl, softened } = started;
  try {
    return {
      canvas,
      gl,
      softened,
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
