import {
  createGlCanvas,
  createPageTextures,
  createProgram,
  type Gl,
  type PageTextures,
  type PaperCanvas,
  type Program,
} from './gl';
import type { SheetGrid } from './mesh';
import { SHEET_FRAGMENT, SHEET_VERTEX } from './shaders';
import { createShadowPass, type ShadowPass } from './shadow';

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

/** The GPU set up to draw sheets and their shadows, or null where it is not to be had. */
export function createGpu(): Gpu | null {
  const made = createGlCanvas();
  if (!made) return null;
  const { canvas, gl } = made;
  try {
    return {
      canvas,
      gl,
      sheet: createProgram(
        gl,
        SHEET_VERTEX,
        SHEET_FRAGMENT,
        ['aPosition', 'aNormal', 'aUv'],
        [...SHEET_UNIFORMS, ...FACES.flat()],
      ),
      shadow: createShadowPass(gl),
      sheets: [],
      uvs: gl.createBuffer(),
      indices: gl.createBuffer(),
      textures: createPageTextures(gl),
      bare: bareTexture(gl),
      mesh: null,
      grid: '',
    };
  } catch (error) {
    console.error(
      '[rito] the paper turn cannot use the GPU; turns fall back to a plain one',
      error,
    );
    return null;
  }
}

function bareTexture(gl: Gl): WebGLTexture {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const clear = new Uint8Array([0, 0, 0, 0]);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, clear);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  return texture;
}
