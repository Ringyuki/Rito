import type { CoreReaderPrimitive, CoreReaderPrimitiveList } from './core-contracts';
import { drawCanvasRubyFragment, drawCanvasTextFragment } from './canvas-text/renderer';
import type { CanvasTextColorOverride } from './canvas-text/types';
import { applyTransform, drawImage, drawShadow, strokePath, tracePath } from './primitive-blits';
import {
  convertReaderRubyV1,
  convertReaderTextV1,
  toCanvasColorV1,
} from './reader-v1-canvas-converter';
import { isBookOwnedPageGround, isOpaqueColor } from './theme/text-color';

type Primitive = CoreReaderPrimitive;
type FillPrimitive = Extract<Primitive, { readonly kind: 'fill-rect' | 'fill-path' }>;
type TextPrimitive = Extract<Primitive, { readonly kind: 'text' | 'ruby' }>;

export type CanvasRenderingTarget = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
export type CanvasImageResolver = (src: string) => ImageBitmap | HTMLImageElement | undefined;

export interface PrimitiveRenderOptions {
  readonly resolveImage?: CanvasImageResolver;
  readonly foregroundColor?: string;
  readonly backgroundColor?: string;
}

interface DeviceRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The declared grounds a replay accumulates for the theme override:
 * opaque block backgrounds so far, and the page ground R1 kept for the
 * book. Reset by every page ground. */
interface DeclaredGrounds {
  readonly blockGrounds: { readonly rect: DeviceRect; readonly color: string }[];
  bookOwnedPageGround: string | undefined;
}

interface RenderState extends DeclaredGrounds {
  readonly resolveImage: CanvasImageResolver;
  readonly colorOverride?: CanvasTextColorOverride;
  saveDepth: number;
}

/**
 * Blits a device-resolved primitive list. The canvas is assumed to be
 * device-sized with an identity transform: every coordinate lands on the
 * device grid as the engine resolved it, nothing here measures or snaps.
 * Text runs go to the text painter with their lengths already in device
 * pixels.
 */
export function renderReaderPrimitivesToCanvas(
  list: CoreReaderPrimitiveList,
  target: CanvasRenderingTarget,
  options: PrimitiveRenderOptions = {},
): void {
  const ctx = target as CanvasRenderingContext2D;
  const state = createRenderState(options);
  // Session-scoped tap for paint-parity instruments (pixel-walk probes):
  // observes the exact primitive stream without altering rendering. The
  // second argument tells probes whether this canvas is the on-screen one
  // — spread pre-renders replay the same primitives into offscreen
  // canvases, and a probe that cannot tell them apart records the wrong
  // spread.
  const paintTap = (globalThis as { __ritoPaintTap?: (p: Primitive, onScreen: boolean) => void })
    .__ritoPaintTap;
  const onScreen =
    typeof (ctx.canvas as { isConnected?: boolean }).isConnected === 'boolean'
      ? (ctx.canvas as unknown as { isConnected: boolean }).isConnected
      : false;
  let rendered = 0;
  let failed = 0;
  let firstFailure: unknown;
  ctx.save();
  try {
    for (const primitive of list.commands) {
      paintTap?.(primitive, onScreen);
      // A paint fault is isolated per primitive and never propagates: one
      // bad primitive must not truncate the frame, and an exception
      // escaping the paint path would leave the spread permanently "not
      // ready" and wedge paging into it. The fault is recorded loudly
      // instead; the canvas keeps everything else.
      const entryDepth = state.saveDepth;
      try {
        renderPrimitive(ctx, primitive, state);
      } catch (error) {
        failed += 1;
        firstFailure ??= error;
        recordRenderFailure(error, primitive, rendered, list.commands.length);
        while (state.saveDepth > entryDepth) {
          ctx.restore();
          state.saveDepth -= 1;
        }
      }
      rendered += 1;
    }
  } finally {
    while (state.saveDepth > 0) {
      ctx.restore();
      state.saveDepth -= 1;
    }
    ctx.restore();
  }
  if (failed > 0) {
    console.error(
      `[rito] primitive list rendered degraded: ${String(failed)}/${String(list.commands.length)} ` +
        `primitives failed (details in globalThis.__ritoRenderFailures)`,
      firstFailure,
    );
  }
}

/** Publish a paint fault for support diagnostics, keeping the last few. */
export function recordRenderFailure(
  error: unknown,
  command: { readonly kind: string },
  commandIndex: number,
  totalCommands: number,
): void {
  const scope = globalThis as { __ritoRenderFailures?: unknown[] };
  const failedCommand: unknown = (() => {
    try {
      return JSON.parse(
        JSON.stringify(command, (_key, value: unknown) =>
          typeof value === 'bigint' ? value.toString() : value,
        ),
      ) as unknown;
    } catch {
      return { kind: command.kind };
    }
  })();
  scope.__ritoRenderFailures = [
    ...(scope.__ritoRenderFailures ?? []).slice(-9),
    {
      message: String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 600) : undefined,
      commandIndex,
      totalCommands,
      failedCommand,
      at: new Date().toISOString(),
    },
  ];
}

function createRenderState(options: PrimitiveRenderOptions): RenderState {
  const colorOverride =
    options.foregroundColor !== undefined && options.backgroundColor !== undefined
      ? {
          foregroundColor: options.foregroundColor,
          backgroundColor: options.backgroundColor,
        }
      : undefined;
  return {
    resolveImage: options.resolveImage ?? (() => undefined),
    saveDepth: 0,
    blockGrounds: [],
    bookOwnedPageGround: undefined,
    ...(colorOverride ? { colorOverride } : {}),
  };
}

function renderPrimitive(
  ctx: CanvasRenderingContext2D,
  primitive: Primitive,
  state: RenderState,
): void {
  switch (primitive.kind) {
    case 'push-state':
      ctx.save();
      state.saveDepth += 1;
      return;
    case 'pop-state':
      if (state.saveDepth === 0) {
        throw new Error('Primitive pop-state has no matching push-state.');
      }
      ctx.restore();
      state.saveDepth -= 1;
      return;
    case 'translate':
      ctx.translate(primitive.dx, primitive.dy);
      return;
    case 'opacity':
      ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1) * primitive.value;
      return;
    case 'transform':
      applyTransform(ctx, primitive);
      return;
    case 'clip-path':
      ctx.beginPath();
      tracePath(ctx, primitive.path);
      ctx.clip();
      return;
    case 'fill-rect': {
      const { rect } = primitive;
      ctx.fillStyle = declareGround(primitive, state);
      ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
      return;
    }
    case 'fill-path':
      ctx.fillStyle = declareGround(primitive, state);
      ctx.beginPath();
      tracePath(ctx, primitive.path);
      ctx.fill(primitive.rule);
      return;
    case 'stroke-path':
      strokePath(ctx, primitive);
      return;
    case 'shadow':
      drawShadow(ctx, primitive);
      return;
    case 'draw-image':
      drawImage(ctx, primitive, state.resolveImage);
      return;
    case 'text':
    case 'ruby':
      renderText(ctx, primitive, state);
      return;
    default:
      return assertNever(primitive);
  }
}

/** The colour a fill paints, after its declared ground is taken in. A
 * fill declaring the page ground resets the declared grounds and takes
 * the theme's R1 decision: a designed ground (opaque, darker than the
 * white-paper limit) stays the book's and marks the page book-owned; a
 * near-white ground is the typesetter's paper default and the theme
 * paints its own. A fill declaring a block ground records the unsnapped
 * box it covers for the ink typeset over it (the engine only declares
 * opaque ones). */
function declareGround(primitive: FillPrimitive, state: RenderState): string {
  const color = toCanvasColorV1(primitive.color);
  if (primitive.ground === 'page') {
    state.blockGrounds.length = 0;
    state.bookOwnedPageGround = undefined;
    if (state.colorOverride) {
      if (isBookOwnedPageGround(color)) state.bookOwnedPageGround = color;
      else return state.colorOverride.backgroundColor;
    }
  } else if (primitive.ground === 'block' && primitive.groundRect !== undefined) {
    state.blockGrounds.push({ rect: primitive.groundRect, color });
  }
  return color;
}

/** The ground a run's ink was typeset against, when the book expressed
 * one (R2): the run's own inline background, else the nearest opaque
 * block background containing the run's rect, else the page ground R1
 * kept for the book. Undefined means the theme supplies the ground. */
function declaredGroundFor(
  rect: DeviceRect,
  paint: { readonly backgroundColor?: string },
  state: DeclaredGrounds,
): string | undefined {
  const runBackground = paint.backgroundColor;
  if (runBackground !== undefined && isOpaqueColor(runBackground)) return runBackground;
  for (let index = state.blockGrounds.length - 1; index >= 0; index -= 1) {
    const ground = state.blockGrounds[index];
    if (
      ground !== undefined &&
      rect.x >= ground.rect.x &&
      rect.y >= ground.rect.y &&
      rect.x + rect.width <= ground.rect.x + ground.rect.width &&
      rect.y + rect.height <= ground.rect.y + ground.rect.height
    ) {
      return ground.color;
    }
  }
  return state.bookOwnedPageGround;
}

/** Text runs go to the text painter with their lengths already in device
 * pixels. */
function renderText(
  ctx: CanvasRenderingContext2D,
  primitive: TextPrimitive,
  state: RenderState,
): void {
  if (primitive.kind === 'text') {
    const command = convertReaderTextV1(primitive);
    drawCanvasTextFragment(
      ctx,
      {
        text: command.text,
        rect: command.rect,
        paint: command.paint,
        ...(command.alignRight === undefined ? {} : { alignRight: command.alignRight }),
        ...(command.vertical === undefined ? {} : { vertical: command.vertical }),
      },
      state.colorOverride,
      declaredGroundFor(command.rect, command.paint, state),
    );
    return;
  }
  const command = convertReaderRubyV1(primitive);
  drawCanvasRubyFragment(
    ctx,
    {
      text: command.text,
      rect: command.rect,
      paint: command.paint,
      ...(command.rubyAlign === undefined ? {} : { rubyAlign: command.rubyAlign }),
      ...(command.vertical === undefined ? {} : { vertical: command.vertical }),
    },
    state.colorOverride,
    declaredGroundFor(command.rect, command.paint, state),
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported reader primitive: ${JSON.stringify(value)}`);
}
