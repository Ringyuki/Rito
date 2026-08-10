import type { Rect } from '../../../layout/core/types';
import type { LengthPct, TransformFn } from '../../../style/core/paint-types';
import type { ImageAssetResolver } from '../../assets/types';
import type { DisplayListRenderer } from '../types';
import type {
  DisplayList,
  DisplayListOptions,
  DrawCommand,
  PaintBlockCommand,
  PaintHorizontalRuleCommand,
  PaintImageCommand,
  PaintRubyCommand,
  PaintTextCommand,
} from '../../display-list';
import { renderBlockDecoration, traceRoundedRect } from './background/background-renderer';
import { createCanvasImageResolver } from './image-resolver';
import { drawRubyFragment, drawTextFragment } from './text/text-renderer';
import { isBookOwnedPageGround, isOpaqueColor } from '../../../utils/color';

export type CanvasRenderingTarget = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export interface CanvasDisplayListOptions {
  readonly pixelRatio?: number;
  readonly images?: ReadonlyMap<string, ImageBitmap>;
  readonly imageResolver?: ImageAssetResolver<ImageBitmap>;
  readonly backgroundColor?: string;
  readonly foregroundColor?: string;
}

export interface CanvasRenderOptions extends DisplayListOptions, CanvasDisplayListOptions {}

export const canvasDisplayListRenderer: DisplayListRenderer<
  CanvasRenderingTarget,
  CanvasDisplayListOptions
> = {
  render: renderDisplayListToCanvas,
};

function renderDisplayListToCanvas(
  displayList: DisplayList,
  ctx: CanvasRenderingTarget,
  options?: CanvasDisplayListOptions,
): void {
  const canvasCtx = ctx as CanvasRenderingContext2D;
  const state = createCanvasRenderState(options);
  canvasCtx.save();
  canvasCtx.scale(options?.pixelRatio ?? 1, options?.pixelRatio ?? 1);

  for (const command of displayList.commands) {
    renderCommand(canvasCtx, command, state);
  }

  canvasCtx.restore();
}

interface CanvasRenderState {
  readonly resolveImage: (src: string) => ImageBitmap | undefined;
  readonly colorOverride?: { readonly foregroundColor: string; readonly backgroundColor: string };
  // Declared-ground tracking for the theme override (R1/R2), mirroring
  // the browser frame-command renderer: opaque block backgrounds
  // replayed so far, and the page ground when R1 kept the book's own
  // color. Reset by every paintPage command.
  readonly blockGrounds: { readonly rect: Rect; readonly color: string }[];
  bookOwnedPageGround: string | undefined;
}

function createCanvasRenderState(options: CanvasDisplayListOptions | undefined): CanvasRenderState {
  const colorOverride =
    options?.foregroundColor !== undefined && options.backgroundColor !== undefined
      ? { foregroundColor: options.foregroundColor, backgroundColor: options.backgroundColor }
      : undefined;
  if (options?.imageResolver) {
    const imageResolver = options.imageResolver;
    return {
      resolveImage: (src: string) => imageResolver.resolveImage(src),
      blockGrounds: [],
      bookOwnedPageGround: undefined,
      ...(colorOverride ? { colorOverride } : {}),
    };
  }
  const resolveImage = options?.images
    ? createCanvasImageResolver(options.images)
    : () => undefined;
  return {
    resolveImage,
    blockGrounds: [],
    bookOwnedPageGround: undefined,
    ...(colorOverride ? { colorOverride } : {}),
  };
}

/** The ground a run's ink was typeset against, when the book expressed
 * one (R2): the run's own inline background, else the nearest opaque
 * block background containing the run's rect, else the page ground R1
 * kept for the book. Undefined means the theme supplies the ground. */
function declaredGroundFor(
  rect: Rect,
  paint: { readonly backgroundColor?: string },
  state: CanvasRenderState,
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

function renderCommand(
  ctx: CanvasRenderingContext2D,
  command: DrawCommand,
  state: CanvasRenderState,
): void {
  switch (command.kind) {
    case 'pushState':
      ctx.save();
      break;
    case 'popState':
      ctx.restore();
      break;
    case 'translate':
      ctx.translate(command.dx, command.dy);
      break;
    case 'transform':
      applyTransform(ctx, command.transforms, command.origin.x, command.origin.y, command.box);
      break;
    case 'opacity':
      // Canvas save/restore scopes alpha, but assigning here would replace a
      // parent block's opacity. CSS opacity composes multiplicatively.
      ctx.globalAlpha = currentGlobalAlpha(ctx) * command.value;
      break;
    case 'clipRect':
      applyClipRect(ctx, command);
      break;
    case 'paintPage':
      paintPage(ctx, command.paint.backgroundColor, command.rect, state);
      break;
    case 'paintBlock':
      trackBlockGround(command, state);
      paintBlock(ctx, command, state);
      break;
    case 'paintText':
      paintText(ctx, command, state);
      break;
    case 'paintRuby':
      paintRuby(ctx, command, state);
      break;
    case 'paintImage':
      paintImage(ctx, command, state);
      break;
    case 'paintHorizontalRule':
      paintHorizontalRule(ctx, command);
      break;
    default:
      assertNever(command);
  }
}

function currentGlobalAlpha(ctx: CanvasRenderingContext2D): number {
  return Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported display-list command: ${JSON.stringify(value)}`);
}

function applyClipRect(
  ctx: CanvasRenderingContext2D,
  command: Extract<DrawCommand, { kind: 'clipRect' }>,
): void {
  const { rect, radius } = command;
  if (radius && (radius.rx > 0 || radius.ry > 0)) {
    traceRoundedRect(ctx, rect.x, rect.y, rect.width, rect.height, radius.rx, radius.ry);
  } else {
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
  }
  ctx.clip();
}

function paintPage(
  ctx: CanvasRenderingContext2D,
  backgroundColor: string | undefined,
  rect: Rect,
  state: CanvasRenderState,
): void {
  if (!backgroundColor) return;
  state.blockGrounds.length = 0;
  state.bookOwnedPageGround = undefined;
  // R1, page-ground ownership (see the browser frame-command renderer,
  // which this reference mirrors): a designed ground stays the book's
  // and marks the page book-owned; the white-paper default is taken
  // over by the theme.
  let fill = backgroundColor;
  if (state.colorOverride) {
    if (isBookOwnedPageGround(backgroundColor)) {
      state.bookOwnedPageGround = backgroundColor;
    } else {
      fill = state.colorOverride.backgroundColor;
    }
  }
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function trackBlockGround(command: PaintBlockCommand, state: CanvasRenderState): void {
  const color = command.paint.background?.color;
  if (color !== undefined && isOpaqueColor(color)) {
    state.blockGrounds.push({ rect: command.rect, color });
  }
}

function paintBlock(
  ctx: CanvasRenderingContext2D,
  command: PaintBlockCommand,
  state: CanvasRenderState,
): void {
  const radius = {
    rx:
      command.paint.radius?.pct !== undefined
        ? (command.paint.radius.pct / 100) * command.rect.width
        : (command.paint.radius?.px ?? 0),
    ry:
      command.paint.radius?.pct !== undefined
        ? (command.paint.radius.pct / 100) * command.rect.height
        : (command.paint.radius?.px ?? 0),
  };
  renderBlockDecoration(
    ctx,
    {
      rect: command.rect,
      paint: command.paint,
      ...(command.borderBox ? { borderBox: command.borderBox } : {}),
    },
    radius,
    state.resolveImage,
  );
}

function paintText(
  ctx: CanvasRenderingContext2D,
  command: PaintTextCommand,
  state: CanvasRenderState,
): void {
  drawTextFragment(
    ctx,
    {
      text: command.text,
      rect: command.rect,
      paint: command.paint,
    },
    state.colorOverride,
    declaredGroundFor(command.rect, command.paint, state),
  );
}

function paintRuby(
  ctx: CanvasRenderingContext2D,
  command: PaintRubyCommand,
  state: CanvasRenderState,
): void {
  drawRubyFragment(
    ctx,
    {
      text: command.text,
      rect: command.rect,
      paint: command.paint,
    },
    state.colorOverride,
    declaredGroundFor(command.rect, command.paint, state),
  );
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  command: PaintImageCommand,
  state: CanvasRenderState,
): void {
  const bitmap = state.resolveImage(command.src);
  if (!bitmap) return;
  const { rect } = command;
  // Chromium's DOM raster downscales replaced images with its high-
  // quality filter; the canvas default ('low') hardens anime linework
  // past the raster floor. Match the browser, like the production path.
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
}

function paintHorizontalRule(
  ctx: CanvasRenderingContext2D,
  command: PaintHorizontalRuleCommand,
): void {
  const { rect, paint } = command;
  const rawY = rect.y + rect.height / 2;
  const snap = rect.height % 2 === 1 ? 0.5 : 0;
  const y = Math.round(rawY) + snap;
  ctx.save();
  ctx.strokeStyle = paint.color;
  if (paint.style === 'dotted') {
    ctx.lineWidth = rect.height * 0.75;
    ctx.setLineDash([0.001, rect.height * 1.5]);
    ctx.lineCap = 'round';
  } else if (paint.style === 'dashed') {
    ctx.lineWidth = rect.height;
    ctx.setLineDash([rect.height * 3, rect.height * 2]);
  } else {
    ctx.lineWidth = rect.height;
  }
  ctx.beginPath();
  ctx.moveTo(Math.round(rect.x), y);
  ctx.lineTo(Math.round(rect.x + rect.width), y);
  ctx.stroke();
  ctx.restore();
}

function applyTransform(
  ctx: CanvasRenderingContext2D,
  transforms: readonly TransformFn[],
  cx: number,
  cy: number,
  box: { readonly width: number; readonly height: number },
): void {
  ctx.translate(cx, cy);
  for (const fn of transforms) {
    if (fn.kind === 'rotate') ctx.rotate(fn.rad);
    else if (fn.kind === 'scale') ctx.scale(fn.sx, fn.sy);
    else ctx.translate(resolveLengthPct(fn.x, box.width), resolveLengthPct(fn.y, box.height));
  }
  ctx.translate(-cx, -cy);
}

function resolveLengthPct(v: LengthPct, basis: number): number {
  return v.unit === 'percent' ? (v.value / 100) * basis : v.value;
}
