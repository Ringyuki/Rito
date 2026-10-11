import type { TransitionPage } from '../effects';
import type { Curl } from './curl';
import { drawSheet, liesOnThePages, outline, uploadSheets, type SheetPart } from './draw-sheet';
import type { PageSnapshot } from './gl';
import { finishGpu, gpuDone, startGpu, type Gpu, type StartedGpu } from './gpu';
import { LIES_BELOW } from './light';
import type { SheetGrid } from './mesh';

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
  /**
   * The curl of a page curled over on itself, part of it still lying on the
   * pages: that part is drawn under the shadows, which fall on it as on any
   * page, and its back shows its own front through.
   */
  readonly curl?: Curl;
  /** That it lies flat and is laid out the same from frame to frame. */
  readonly still?: boolean;
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
 * The sheets lying flat are the pages: they are drawn first, with what lies
 * on them of a page curled over; the shadows of the paper in the air are
 * laid over them, and that paper is drawn last.
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
  const standing = frame.sheets.map((sheet) => !liesOnThePages(sheet));

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, width, height);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  gl.enable(gl.DEPTH_TEST);
  gl.depthFunc(gl.LEQUAL);
  const drawn = (index: number, part: SheetPart): void => {
    drawSheet(gpu, frame, index, mesh, eye, part);
  };
  frame.sheets.forEach((sheet, index) => {
    if (!standing[index]) drawn(index, 'whole');
    else if (sheet.curl) drawn(index, 'lying');
  });

  castShadows(gpu, frame, mesh, eye, standing);

  gl.enable(gl.DEPTH_TEST);
  // An edge softened where it is drawn lets what lies beneath show through it.
  if (gpu.softened) {
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
  frame.sheets.forEach((sheet, index) => {
    if (standing[index]) drawn(index, sheet.curl ? 'lifted' : 'whole');
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
      // What lies on the pages of a page curled over is where its shadow falls, and hides nothing.
      offPage: sheet.curl ? LIES_BELOW : -1,
      curl: sheet.curl ?? null,
      positions: buffers.positions,
      indices: gpu.indices,
      indexCount: mesh.indices.length,
    });
  });
  gpu.shadow.lay(width, height);
}
