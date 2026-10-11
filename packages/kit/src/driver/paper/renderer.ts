import type { TransitionPage } from '../effects';
import { attribute, type PageSnapshot } from './gl';
import {
  FACES,
  finishGpu,
  gpuDone,
  startGpu,
  type Gpu,
  type SheetBuffers,
  type StartedGpu,
} from './gpu';
import { KEY_DIRECTION, KEY_SHARE, PAPER_ALBEDO, PAPER_THROUGH } from './light';
import { sheetGrid, type SheetGrid } from './mesh';

/**
 * One sheet of the book as a frame shows it: a leaf in the air, or one of
 * the two lying flat that the leaves leave and land on.
 */
export interface PaperSheet {
  /** x, y, z of a grid of points over the sheet, row by row from the spine outward. */
  readonly positions: Float32Array;
  /** The direction the paper faces at each of those points. */
  readonly normals: Float32Array;
  /** The spread printed on its front, of which it shows the half right of the spine. */
  readonly front: PageSnapshot | null;
  /** The spread printed on its back, of which it shows the half left of the spine. */
  readonly back: PageSnapshot | null;
  /** How far over it is, 0 lying right and 1 lying left: what says which sheet lies on which. */
  readonly shown: number;
}

/** One frame: the sheets from the front of the book to the back, and the paper they are made of. */
export interface PaperFrame {
  readonly width: number;
  readonly height: number;
  readonly spine: number;
  readonly columns: number;
  readonly rows: number;
  readonly sheets: readonly PaperSheet[];
  /** The paper's colour, red, green and blue from 0 to 1. */
  readonly paper: readonly [number, number, number];
}

export interface PaperRenderer {
  /** Counts the GPU contexts made: a snapshot is good for the one it was taken in. */
  readonly epoch: number;
  /**
   * Whether frames can be drawn: `waiting` while the GPU is still compiling
   * what it was handed, `none` where there is no GPU to be had.
   */
  readonly standing: 'ready' | 'waiting' | 'none';
  /** Hands the GPU its programs ahead of the first frame, without waiting for them. */
  prepare(): void;
  /** The page as last painted, held until released. Null where the GPU is not to be had. */
  snapshot(page: TransitionPage): PageSnapshot | null;
  release(snapshot: PageSnapshot): void;
  /** Draws the sheets and the shadows they cast, at the frame's size. Null without a GPU. */
  draw(frame: PaperFrame): CanvasImageSource | null;
}

/** The eye's height above the spread, in spreads. Lower exaggerates what rises. */
const EYE_HEIGHT = 2.4;
/** A sheet standing less than this above the pages, in the frame's units, casts no shadow. */
const LYING = 0.5;
/** How far apart sheets lying on each other are told to the depth test, in the frame's units. */
const SHEET_APART = 0.05;
/** How high the eye is over a spread of this size. */
export function eyeHeight(width: number, height: number): number {
  return EYE_HEIGHT * Math.max(width, height);
}

/** `make` is how the GPU is set to work; a test brings its own. */
export function createPaperRenderer(make: () => StartedGpu | null = startGpu): PaperRenderer {
  let gpu: Gpu | null | undefined;
  let started: StartedGpu | null = null;
  let losses = 0;
  let epoch = 0;
  const prepare = (): void => {
    if (gpu !== undefined || started) return;
    started = make();
    if (!started) gpu = null;
  };
  const standing = (): 'ready' | 'waiting' | 'none' => {
    if (gpu?.gl.isContextLost()) {
      // A lost context is asked for again twice, then given up on.
      losses += 1;
      gpu = losses > 2 ? null : undefined;
    }
    prepare();
    if (started) {
      if (!gpuDone(started)) return 'waiting';
      gpu = finishGpu(started);
      started = null;
      epoch += 1;
    }
    return gpu ? 'ready' : 'none';
  };
  return {
    get epoch(): number {
      return epoch;
    },
    get standing(): 'ready' | 'waiting' | 'none' {
      return standing();
    },
    prepare,
    snapshot: (page) => gpu?.textures.take(page) ?? null,
    release(snapshot): void {
      if (gpu && !gpu.gl.isContextLost()) gpu.textures.release(snapshot);
    },
    draw(frame): CanvasImageSource | null {
      if (!gpu || gpu.gl.isContextLost()) return null;
      drawFrame(gpu, frame);
      return gpu.canvas;
    },
  };
}

/**
 * The sheets lying flat are the pages: they are drawn first, the shadows of
 * the sheets in the air are laid over them, and those sheets are drawn last.
 */
function drawFrame(gpu: Gpu, frame: PaperFrame): void {
  const { gl, canvas } = gpu;
  const width = Math.max(1, Math.round(frame.width));
  const height = Math.max(1, Math.round(frame.height));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
  const mesh = uploadSheets(gpu, frame);
  const eye = eyeHeight(width, height);
  const standing = frame.sheets.map((sheet) => tallestOf(sheet.positions) > LYING);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  const drawn = (index: number): void => {
    const sheet = frame.sheets[index];
    const buffers = gpu.sheets[index];
    if (sheet && buffers) drawSheet(gpu, frame, sheet, buffers, mesh, eye, liftOf(frame, index));
  };
  frame.sheets.forEach((_, index) => {
    if (!standing[index]) drawn(index);
  });

  castShadows(gpu, frame, mesh, eye, standing);

  gl.enable(gl.DEPTH_TEST);
  // An edge softened where it is drawn lets what lies beneath show through it.
  if (gpu.softened) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  frame.sheets.forEach((_, index) => {
    if (standing[index]) drawn(index);
  });
  gl.disable(gl.BLEND);
}

/** Lays over the pages the darkness every sheet standing off them leaves there. */
function castShadows(
  gpu: Gpu,
  frame: PaperFrame,
  mesh: SheetGrid,
  eye: number,
  standing: readonly boolean[],
): void {
  const width = Math.max(1, Math.round(frame.width));
  const height = Math.max(1, Math.round(frame.height));
  gpu.shadow.begin(width, height, frame.spine);
  frame.sheets.forEach((sheet, index) => {
    const buffers = gpu.sheets[index];
    if (!standing[index] || !buffers) return;
    gpu.shadow.cast({
      width,
      height,
      eye,
      ...outline(frame, sheet.positions),
      positions: buffers.positions,
      indices: gpu.indices,
      indexCount: mesh.indices.length,
    });
  });
  gpu.shadow.lay(width, height);
}

/**
 * How far a sheet is lifted for the depth test alone. Lying right, a sheet
 * nearer the front of the book lies on the ones behind it; lying left, the
 * other way about.
 */
function liftOf(frame: PaperFrame, index: number): number {
  const shown = frame.sheets[index]?.shown ?? 0;
  const behind = frame.sheets.length - 1 - index;
  return SHEET_APART * ((1 - shown) * behind + shown * index);
}

function tallestOf(positions: Float32Array): number {
  let tallest = 0;
  for (let index = 2; index < positions.length; index += 3) {
    tallest = Math.max(tallest, positions[index] ?? 0);
  }
  return tallest;
}

/** Sends every sheet's surface, and the way each point of it faces, to the GPU. */
function uploadSheets(gpu: Gpu, frame: PaperFrame): SheetGrid {
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
  frame.sheets.forEach((sheet, index) => {
    const buffers = (gpu.sheets[index] ??= {
      positions: gl.createBuffer(),
      normals: gl.createBuffer(),
    });
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.positions);
    gl.bufferData(gl.ARRAY_BUFFER, sheet.positions, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffers.normals);
    gl.bufferData(gl.ARRAY_BUFFER, sheet.normals, gl.DYNAMIC_DRAW);
  });
  return gpu.mesh;
}

function drawSheet(
  gpu: Gpu,
  frame: PaperFrame,
  sheet: PaperSheet,
  buffers: SheetBuffers,
  mesh: SheetGrid,
  eye: number,
  lift: number,
): void {
  const { gl, sheet: program } = gpu;
  const reach = frame.width - frame.spine;
  gl.useProgram(program.program);
  gl.uniform2f(program.uniforms['uSize'] ?? null, frame.width, frame.height);
  gl.uniform1f(program.uniforms['uEye'] ?? null, eye);
  gl.uniform1f(program.uniforms['uDepth'] ?? null, reach * 1.25);
  gl.uniform1f(program.uniforms['uLift'] ?? null, lift);
  gl.uniform1f(program.uniforms['uSpine'] ?? null, frame.spine / frame.width);
  gl.uniform1f(program.uniforms['uSheet'] ?? null, reach / frame.width);
  gl.uniform3f(program.uniforms['uPaper'] ?? null, ...frame.paper);
  gl.uniform3f(program.uniforms['uLight'] ?? null, ...KEY_DIRECTION);
  gl.uniform1f(program.uniforms['uKeyShare'] ?? null, KEY_SHARE);
  gl.uniform1f(program.uniforms['uThrough'] ?? null, PAPER_THROUGH);
  gl.uniform1f(program.uniforms['uAlbedo'] ?? null, PAPER_ALBEDO);
  [sheet.front, sheet.back].forEach((page, unit) => {
    const [sampler, printed] = FACES[unit] ?? FACES[0];
    gl.activeTexture(unit === 0 ? gl.TEXTURE0 : gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, page ? page.texture : gpu.bare);
    gl.uniform1i(program.uniforms[sampler] ?? null, unit);
    gl.uniform1f(program.uniforms[printed] ?? null, page ? 1 : 0);
  });
  attribute(gl, program, 'aPosition', buffers.positions, 3);
  attribute(gl, program, 'aNormal', buffers.normals, 3);
  attribute(gl, program, 'aUv', gpu.uvs, 2);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gpu.indices);
  gl.drawElements(gl.TRIANGLES, mesh.indices.length, gl.UNSIGNED_SHORT, 0);
}

/** How far out from the spine the leaf's shape is sampled for its shadow, as shares of its width. */
const PROFILE = [0.03, 0.25, 0.6, 1];

/** How high the leaf stands at most, and its shape in eight rows of four points: what its shadow is worked out from. */
function outline(
  frame: PaperFrame,
  positions: Float32Array,
): { tallest: number; profile: Float32Array } {
  const { columns, rows } = frame;
  const profile = new Float32Array(8 * PROFILE.length * 3);
  for (let line = 0; line < 8; line += 1) {
    const row = Math.round((line / 7) * (rows - 1));
    PROFILE.forEach((out, point) => {
      const at = (row * columns + Math.round(out * (columns - 1))) * 3;
      profile.set(positions.subarray(at, at + 3), (line * PROFILE.length + point) * 3);
    });
  }
  return { tallest: Math.max(1, tallestOf(positions)), profile };
}
