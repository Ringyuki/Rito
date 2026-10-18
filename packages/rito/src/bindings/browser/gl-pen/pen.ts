import type { CanvasTextColorOverride } from '../canvas-text/types';
import type { CoreReaderPrimitive, CoreReaderPrimitiveList } from '../core-contracts';
import { recordRenderFailure, type PrimitiveRenderOptions } from '../primitive-renderer';
import { toCanvasColor } from '../reader-session-canvas-converter';
import {
  createDeclaredGrounds,
  declareFillGround,
  type DeclaredGrounds,
} from '../theme/declared-grounds';
import { QuadBatch } from './batch';
import { canvasChannels, paintsInColor } from './color-probe';
import { penDevice, type GlPenDevice } from './device';
import { webglOnGpu } from './hardware';
import { paintThroughCanvas } from './canvas-copy';
import { drawRunGlyphs } from './run';
import { RunInks } from './run-ink';
import { paintsWhollyOnGpu, wholePixelRect } from './split';
import type { ReaderGlTarget } from './target';

type Primitive = CoreReaderPrimitive;
type TextPrimitive = Extract<Primitive, { readonly kind: 'text' | 'ruby' }>;

export interface GlPrimitiveRenderOptions extends PrimitiveRenderOptions {
  /** What the target is filled with before the list, as a canvas paints it; none leaves it clear. */
  readonly ground?: string | undefined;
  /**
   * Target device pixels per device pixel of the list: 1 on the list's own
   * grid. Any other (a host zoom) paints the whole list with the canvas pen
   * under that scale.
   */
  readonly scale?: number;
}

interface Scissor {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

interface WalkState {
  tx: number;
  ty: number;
  scissor: Scissor | null;
}

interface Walk {
  readonly device: GlPenDevice;
  readonly batch: QuadBatch;
  readonly grounds: DeclaredGrounds;
  readonly override: CanvasTextColorOverride | undefined;
  readonly inks: RunInks;
}

/**
 * Paints a device-resolved primitive list into a WebGL2 framebuffer, pixel
 * for pixel as the canvas pen paints it on a canvas. A list of nothing but
 * primitives the GPU paints exactly (most pages of text) is drawn on the
 * GPU; any other, a list off the device grid, or any list where WebGL has
 * no GPU, is painted by the canvas pen and copied in. Answers false when
 * the context is lost.
 */
export function renderReaderPrimitivesToGl(
  list: CoreReaderPrimitiveList,
  target: ReaderGlTarget,
  options: GlPrimitiveRenderOptions = {},
): boolean {
  const device = penDevice(target.gl);
  if (device === undefined) return false;
  const gl = target.gl;
  const scale = options.scale ?? 1;
  const onGpu =
    scale === 1 && webglOnGpu() && paintsWhollyOnGpu(list, paintsInColor, themeOpaque(options));
  // Session-scoped tap for instruments: which pen painted the list.
  (globalThis as { __ritoGlPenTap?: (onGpu: boolean) => void }).__ritoGlPenTap?.(onGpu);
  gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
  gl.viewport(0, 0, target.width, target.height);
  gl.disable(gl.SCISSOR_TEST);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.STENCIL_TEST);
  gl.disable(gl.CULL_FACE);
  gl.colorMask(true, true, true, true);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(device.vertexArray);
  try {
    if (onGpu) {
      clearToGround(gl, options.ground);
      paintOnGpu(device, list, target, options);
    } else {
      paintThroughCanvas(device, list, target, { ...options, scale });
    }
  } finally {
    gl.disable(gl.SCISSOR_TEST);
    gl.bindVertexArray(null);
  }
  return true;
}

function clearToGround(gl: WebGL2RenderingContext, ground: string | undefined): void {
  const [red, green, blue, alpha] = ground ? canvasChannels(ground) : [0, 0, 0, 0];
  const a = alpha / 255;
  gl.clearColor((red / 255) * a, (green / 255) * a, (blue / 255) * a, a);
  gl.clear(gl.COLOR_BUFFER_BIT);
}

/** Whether the theme's ink and paper, when there is a theme, are opaque. */
function themeOpaque(options: PrimitiveRenderOptions): boolean {
  const override = overrideOf(options);
  return (
    override === undefined ||
    (canvasChannels(override.foregroundColor)[3] === 255 &&
      canvasChannels(override.backgroundColor)[3] === 255)
  );
}

function overrideOf(options: PrimitiveRenderOptions): CanvasTextColorOverride | undefined {
  return options.foregroundColor !== undefined && options.backgroundColor !== undefined
    ? { foregroundColor: options.foregroundColor, backgroundColor: options.backgroundColor }
    : undefined;
}

/** Draws a list on the GPU, keeping the translation, the clip and the grounds the theme reads ink against. */
function paintOnGpu(
  device: GlPenDevice,
  list: CoreReaderPrimitiveList,
  target: ReaderGlTarget,
  options: PrimitiveRenderOptions,
): void {
  const grounds = createDeclaredGrounds();
  const override = overrideOf(options);
  const walk: Walk = {
    device,
    batch: new QuadBatch(device, target.width, target.height),
    grounds,
    override,
    inks: new RunInks(device.atlas, list.ratio, override, grounds),
  };

  const tap = (globalThis as { __ritoPaintTap?: (p: Primitive, onScreen: boolean) => void })
    .__ritoPaintTap;
  let state: WalkState = { tx: 0, ty: 0, scissor: null };
  const stack: WalkState[] = [];
  list.commands.forEach((primitive, index) => {
    tap?.(primitive, false);
    try {
      state = step(walk, primitive, state, stack);
    } catch (error) {
      recordRenderFailure(error, primitive, index, list.commands.length);
    }
  });
  walk.batch.flush();
}

function step(walk: Walk, primitive: Primitive, state: WalkState, stack: WalkState[]): WalkState {
  switch (primitive.kind) {
    case 'push-state':
      stack.push(state);
      return { ...state };
    case 'pop-state':
      return stack.pop() ?? state;
    case 'translate':
      state.tx += primitive.dx;
      state.ty += primitive.dy;
      return state;
    case 'clip-path':
      state.scissor = clipped(state, wholePixelRect(primitive.path, state));
      return state;
    case 'fill-rect':
    case 'fill-path': {
      const color = declareFillGround(
        walk.grounds,
        primitive,
        toCanvasColor(primitive.color),
        walk.override,
      );
      if (primitive.kind === 'fill-rect') fill(walk, primitive.rect, color, state);
      return state;
    }
    case 'text':
    case 'ruby':
      drawRun(walk, primitive, state);
      return state;
    case 'opacity':
    case 'transform':
    case 'stroke-path':
    case 'shadow':
    case 'draw-image':
    case 'image-fallback':
      // Never in a list the GPU paints.
      return state;
  }
}

function clipped(state: WalkState, rect: ReturnType<typeof wholePixelRect>): Scissor | null {
  // A list on the GPU clips to whole-pixel rects only.
  if (rect === undefined) return state.scissor;
  const next = {
    left: rect.x + state.tx,
    top: rect.y + state.ty,
    right: rect.x + rect.width + state.tx,
    bottom: rect.y + rect.height + state.ty,
  };
  const outer = state.scissor;
  if (outer === null) return next;
  return {
    left: Math.max(outer.left, next.left),
    top: Math.max(outer.top, next.top),
    right: Math.min(outer.right, next.right),
    bottom: Math.min(outer.bottom, next.bottom),
  };
}

function fill(
  walk: Walk,
  rect: { readonly x: number; readonly y: number; readonly width: number; readonly height: number },
  color: string,
  state: WalkState,
): void {
  const [red, green, blue] = canvasChannels(color);
  walk.batch.clip(state.scissor);
  walk.batch.push('solid', rect.x + state.tx, rect.y + state.ty, rect.width, rect.height, 0, 0, {
    red: red / 255,
    green: green / 255,
    blue: blue / 255,
  });
}

function drawRun(walk: Walk, run: TextPrimitive, state: WalkState): void {
  const table = walk.inks.tableFor(run);
  walk.batch.clip(state.scissor);
  drawRunGlyphs(walk.device, walk.batch, run, table, state);
}
