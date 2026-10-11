import type { TransitionPage } from '../effects';
import {
  attribute,
  createGlCanvas,
  createPageTextures,
  createProgram,
  type Gl,
  type PageTextures,
  type PaperCanvas,
  type Program,
} from './gl';
import { KEY_DIRECTION, KEY_SHARE, PAPER_ALBEDO, PAPER_THROUGH } from './light';
import { sheetGrid, type SheetGrid } from './mesh';
import { SHEET_FRAGMENT, SHEET_VERTEX } from './shaders';
import { createShadowPass, type ShadowPass } from './shadow';

/** One frame of the leaf: where its paper is, how it faces, and the pages on its two faces. */
export interface PaperFrame {
  readonly width: number;
  readonly height: number;
  readonly spine: number;
  /** x, y, z of a grid of points over the sheet, row by row from the spine outward. */
  readonly positions: Float32Array;
  /** The direction the paper faces at each of those points. */
  readonly normals: Float32Array;
  readonly columns: number;
  readonly rows: number;
  /** The spread the sheet is lifted from, or null for bare paper. */
  readonly front: TransitionPage | null;
  /** The spread it lands on, or null for bare paper. */
  readonly back: TransitionPage | null;
  /** The paper's colour, red, green and blue from 0 to 1. */
  readonly paper: readonly [number, number, number];
}

export interface PaperRenderer {
  /**
   * Draws the sheet and the shadow it casts, over nothing, at the frame's
   * size. Null where the GPU is not to be had.
   */
  draw(frame: PaperFrame): CanvasImageSource | null;
}

/** The eye's height above the spread, in spreads. Lower exaggerates what rises. */
const EYE_HEIGHT = 2.4;
/** The sampler of each face of the sheet, and the flag saying a page is printed on it. */
const FACES = [
  ['uFront', 'uHasFront'],
  ['uBack', 'uHasBack'],
] as const;

const SHEET_UNIFORMS = ['uSize', 'uEye', 'uDepth', 'uSpine', 'uSheet', 'uPaper', 'uLight'].concat([
  'uKeyShare',
  'uThrough',
  'uAlbedo',
]);

/** How high the eye is over a spread of this size. */
export function eyeHeight(width: number, height: number): number {
  return EYE_HEIGHT * Math.max(width, height);
}

interface Gpu {
  readonly canvas: PaperCanvas;
  readonly gl: Gl;
  readonly sheet: Program;
  readonly shadow: ShadowPass;
  readonly positions: WebGLBuffer;
  readonly normals: WebGLBuffer;
  readonly uvs: WebGLBuffer;
  readonly indices: WebGLBuffer;
  readonly textures: PageTextures;
  /** What a face with no page samples: nothing. */
  readonly bare: WebGLTexture;
  /** The grid the buffers are laid out for, and which it is. */
  mesh: SheetGrid | null;
  grid: string;
}

export function createPaperRenderer(): PaperRenderer {
  let gpu: Gpu | null | undefined;
  let losses = 0;
  return {
    draw(frame): CanvasImageSource | null {
      if (gpu?.gl.isContextLost()) {
        // A lost context is asked for again twice, then given up on.
        losses += 1;
        gpu = losses > 2 ? null : undefined;
      }
      gpu ??= gpu === undefined ? createGpu() : null;
      if (!gpu) return null;
      drawFrame(gpu, frame);
      return gpu.canvas;
    },
  };
}

function createGpu(): Gpu | null {
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
      positions: gl.createBuffer(),
      normals: gl.createBuffer(),
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

function drawFrame(gpu: Gpu, frame: PaperFrame): void {
  const { gl, canvas } = gpu;
  const width = Math.max(1, Math.round(frame.width));
  const height = Math.max(1, Math.round(frame.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const mesh = uploadSheet(gpu, frame);
  const eye = eyeHeight(width, height);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gpu.shadow.draw({
    width,
    height,
    spine: frame.spine,
    eye,
    ...outline(frame),
    positions: gpu.positions,
    indices: gpu.indices,
    indexCount: mesh.indices.length,
  });
  gl.enable(gl.DEPTH_TEST);
  drawSheet(gpu, frame, mesh, eye);
}

/** Sends the sheet's surface, and the way each point of it faces, to the GPU. */
function uploadSheet(gpu: Gpu, frame: PaperFrame): SheetGrid {
  const { gl } = gpu;
  const grid = `${String(frame.columns)}x${String(frame.rows)}`;
  if (!gpu.mesh || gpu.grid !== grid) {
    gpu.grid = grid;
    gpu.mesh = sheetGrid(frame.columns, frame.rows);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvs);
    gl.bufferData(gl.ARRAY_BUFFER, gpu.mesh.uvs, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gpu.mesh.indices, gl.STATIC_DRAW);
  }
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.positions);
  gl.bufferData(gl.ARRAY_BUFFER, frame.positions, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.normals);
  gl.bufferData(gl.ARRAY_BUFFER, frame.normals, gl.DYNAMIC_DRAW);
  return gpu.mesh;
}

function drawSheet(gpu: Gpu, frame: PaperFrame, mesh: SheetGrid, eye: number): void {
  const { gl, sheet, textures } = gpu;
  const reach = frame.width - frame.spine;
  gl.useProgram(sheet.program);
  gl.uniform2f(sheet.uniforms['uSize'] ?? null, frame.width, frame.height);
  gl.uniform1f(sheet.uniforms['uEye'] ?? null, eye);
  gl.uniform1f(sheet.uniforms['uDepth'] ?? null, reach * 1.25);
  gl.uniform1f(sheet.uniforms['uSpine'] ?? null, frame.spine / frame.width);
  gl.uniform1f(sheet.uniforms['uSheet'] ?? null, reach / frame.width);
  gl.uniform3f(sheet.uniforms['uPaper'] ?? null, ...frame.paper);
  gl.uniform3f(sheet.uniforms['uLight'] ?? null, ...KEY_DIRECTION);
  gl.uniform1f(sheet.uniforms['uKeyShare'] ?? null, KEY_SHARE);
  gl.uniform1f(sheet.uniforms['uThrough'] ?? null, PAPER_THROUGH);
  gl.uniform1f(sheet.uniforms['uAlbedo'] ?? null, PAPER_ALBEDO);
  [frame.front, frame.back].forEach((page, unit) => {
    const [sampler, printed] = FACES[unit] ?? FACES[0];
    gl.activeTexture(unit === 0 ? gl.TEXTURE0 : gl.TEXTURE1);
    if (page) textures.of(page);
    else gl.bindTexture(gl.TEXTURE_2D, gpu.bare);
    gl.uniform1i(sheet.uniforms[sampler] ?? null, unit);
    gl.uniform1f(sheet.uniforms[printed] ?? null, page ? 1 : 0);
  });
  attribute(gl, sheet, 'aPosition', gpu.positions, 3);
  attribute(gl, sheet, 'aNormal', gpu.normals, 3);
  attribute(gl, sheet, 'aUv', gpu.uvs, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indices);
  gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
}

/** How far out from the spine the leaf's shape is sampled for its shadow, as shares of its width. */
const PROFILE = [0.03, 0.25, 0.6, 1];

/** How high the leaf stands at most, and its shape in eight rows of four points: what its shadow is worked out from. */
function outline(frame: PaperFrame): { tallest: number; profile: Float32Array } {
  const { positions, columns, rows } = frame;
  let tallest = 1;
  for (let index = 2; index < positions.length; index += 3) {
    tallest = Math.max(tallest, positions[index] ?? 0);
  }
  const profile = new Float32Array(8 * PROFILE.length * 3);
  for (let line = 0; line < 8; line += 1) {
    const row = Math.round((line / 7) * (rows - 1));
    PROFILE.forEach((out, point) => {
      const at = (row * columns + Math.round(out * (columns - 1))) * 3;
      profile.set(positions.subarray(at, at + 3), (line * PROFILE.length + point) * 3);
    });
  }
  return { tallest, profile };
}
