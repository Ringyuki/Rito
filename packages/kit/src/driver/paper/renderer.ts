import type { PaperTurnCurl } from '@ritojs/core';

import type { TransitionPage } from '../effects';
import { drawSheet, liesOnThePages, outline, uploadSheets, type SheetPart } from './draw-sheet';
import type { Gl, PageSnapshot } from './gl';
import { finishGpu, frameBuffersFor, gpuDone, startGpu, type Gpu, type StartedGpu } from './gpu';
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
  readonly curl?: PaperTurnCurl;
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
  /** How high the eye is over the frame drawn, in its units. */
  readonly eye: number;
  readonly sheets: readonly PaperSheet[];
  /** The paper's colour, red, green and blue from 0 to 1. */
  readonly paper: readonly [number, number, number];
}

export interface PaperRenderer {
  /** Counts the times the GPU was set up: a snapshot is good for the setup it was taken in. */
  readonly epoch: number;
  /**
   * Whether frames can be drawn: `waiting` while the GPU is still compiling
   * what it was handed or its context is lost, `none` where it cannot draw.
   */
  readonly standing: 'ready' | 'waiting' | 'none';
  /**
   * Hands the display's context the programs ahead of the first frame,
   * without waiting for them; again after the context was lost.
   */
  prepare(gl: Gl): void;
  /** The page as last painted, held until released. Null where the GPU is not to be had. */
  snapshot(page: TransitionPage): PageSnapshot | null;
  release(snapshot: PageSnapshot): void;
  /**
   * Draws the sheets and the shadows they cast over the framebuffer bound,
   * at the frame's size. False without a GPU.
   */
  draw(frame: PaperFrame): boolean;
}

/** A length of the frame as it is drawn: whole pixels, at least one. */
export function drawnLength(length: number): number {
  return Math.max(1, Math.round(length));
}

/** `make` is how the GPU is set to work; a test brings its own. */
export function createPaperRenderer(make: (gl: Gl) => StartedGpu | null = startGpu): PaperRenderer {
  let context: Gl | null = null;
  let gpu: Gpu | null | undefined;
  let started: StartedGpu | null = null;
  let epoch = 0;
  const forget = (): void => {
    gpu = undefined;
    started = null;
  };
  const prepare = (gl?: Gl): void => {
    if (gl && gl !== context) {
      context = gl;
      forget();
      // What a lost context held is gone with it; the next frame sets it up again.
      gl.canvas.addEventListener('webglcontextlost', forget);
    }
    if (!context || context.isContextLost() || gpu !== undefined || started) return;
    started = make(context);
    if (!started) gpu = null;
  };
  const standing = (): 'ready' | 'waiting' | 'none' => {
    if (context?.isContextLost()) return 'waiting';
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
    draw(frame): boolean {
      if (!gpu || gpu.gl.isContextLost()) return false;
      drawFrame(gpu, frame);
      return true;
    },
  };
}

/**
 * The sheets lying flat are the pages: they are drawn first, with what lies
 * on them of a page curled over; the shadows of the paper in the air are
 * laid over them, and that paper is drawn last.
 */
function drawFrame(gpu: Gpu, frame: PaperFrame): void {
  const { gl } = gpu;
  const width = drawnLength(frame.width);
  const height = drawnLength(frame.height);
  const drawingTo = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;
  // The sheets set their attributes on the context's own vertex array.
  gl.bindVertexArray(null);
  const mesh = uploadSheets(gpu, frame);
  const { eye } = frame;
  const standing = frame.sheets.map((sheet) => !liesOnThePages(sheet));
  const buffers = frameBuffersFor(gpu, width, height);

  gl.bindFramebuffer(gl.FRAMEBUFFER, buffers.framebuffer);
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
  gl.disable(gl.DEPTH_TEST);
  // The frame is copied over what is drawn to, its samples resolved.
  gl.bindFramebuffer(gl.READ_FRAMEBUFFER, buffers.framebuffer);
  gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, drawingTo);
  gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, drawingTo);
}

/** Lays over the pages the darkness every sheet standing off them leaves there. */
function castShadows(
  gpu: Gpu,
  frame: PaperFrame,
  mesh: SheetGrid,
  eye: number,
  standing: readonly boolean[],
): void {
  const width = drawnLength(frame.width);
  const height = drawnLength(frame.height);
  gpu.shadow.begin(width, height, frame.spine);
  frame.sheets.forEach((sheet, index) => {
    const buffers = gpu.sheets[index];
    if (!standing[index] || !buffers) return;
    gpu.shadow.cast({
      width,
      height,
      eye,
      ...outline(frame, sheet.positions),
      curl: sheet.curl ?? null,
      positions: buffers.positions,
      uvs: gpu.uvs,
      indices: gpu.indices,
      indexCount: mesh.indices.length,
    });
  });
  gpu.shadow.lay(width, height);
}
