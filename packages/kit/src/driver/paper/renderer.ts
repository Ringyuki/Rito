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
import { createSheetMesh, type SheetMesh } from './mesh';
import { SHEET_FRAGMENT, SHEET_VERTEX } from './shaders';
import { createShadowPass, type ShadowPass } from './shadow';

/** One frame of the sheet: where every particle is, and the pages on its two faces. */
export interface PaperFrame {
  readonly width: number;
  readonly height: number;
  readonly spine: number;
  readonly positions: Float32Array;
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

/** Where the light comes from: over the reader's left shoulder. */
const LIGHT = normalized([-0.38, -0.5, 0.78]);
/** The eye's height above the spread, in spreads. Lower exaggerates what rises. */
const EYE_HEIGHT = 3;
/** The sampler of each face of the sheet, and the flag saying a page is printed on it. */
const FACES = [
  ['uFront', 'uHasFront'],
  ['uBack', 'uHasBack'],
] as const;

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
  /** The surface drawn through the particles, for the grid it was made for. */
  mesh: SheetMesh | null;
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
        ['uSize', 'uEye', 'uDepth', 'uSpine', 'uSheet', 'uPaper', 'uLight', ...FACES.flat()],
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
  const reach = frame.width - frame.spine;

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gpu.shadow.draw({
    width,
    height,
    reach,
    eye,
    light: LIGHT,
    positions: gpu.positions,
    indices: gpu.indices,
    indexCount: mesh.indices.length,
  });
  gl.enable(gl.DEPTH_TEST);
  drawSheet(gpu, frame, mesh, eye, reach);
}

/** Sends the sheet's surface, and the way each point of it faces, to the GPU. */
function uploadSheet(gpu: Gpu, frame: PaperFrame): SheetMesh {
  const { gl } = gpu;
  const grid = `${String(frame.columns)}x${String(frame.rows)}`;
  if (!gpu.mesh || gpu.grid !== grid) {
    gpu.grid = grid;
    gpu.mesh = createSheetMesh(frame.columns, frame.rows);
    gl.bindBuffer(gl.ARRAY_BUFFER, gpu.uvs);
    gl.bufferData(gl.ARRAY_BUFFER, gpu.mesh.uvs, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indices);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, gpu.mesh.indices, gl.STATIC_DRAW);
  }
  gpu.mesh.update(frame.positions);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.positions);
  gl.bufferData(gl.ARRAY_BUFFER, gpu.mesh.positions, gl.DYNAMIC_DRAW);
  gl.bindBuffer(gl.ARRAY_BUFFER, gpu.normals);
  gl.bufferData(gl.ARRAY_BUFFER, gpu.mesh.normals, gl.DYNAMIC_DRAW);
  return gpu.mesh;
}

function drawSheet(gpu: Gpu, frame: PaperFrame, mesh: SheetMesh, eye: number, reach: number): void {
  const { gl, sheet, textures } = gpu;
  gl.useProgram(sheet.program);
  gl.uniform2f(sheet.uniforms['uSize'] ?? null, frame.width, frame.height);
  gl.uniform1f(sheet.uniforms['uEye'] ?? null, eye);
  gl.uniform1f(sheet.uniforms['uDepth'] ?? null, reach * 1.25);
  gl.uniform1f(sheet.uniforms['uSpine'] ?? null, frame.spine / frame.width);
  gl.uniform1f(sheet.uniforms['uSheet'] ?? null, reach / frame.width);
  gl.uniform3f(sheet.uniforms['uPaper'] ?? null, ...frame.paper);
  gl.uniform3f(sheet.uniforms['uLight'] ?? null, ...LIGHT);
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

function normalized(vector: [number, number, number]): [number, number, number] {
  const length = Math.hypot(...vector);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}
