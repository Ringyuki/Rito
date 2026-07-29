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
      ...(colorOverride ? { colorOverride } : {}),
    };
  }
  const resolveImage = options?.images
    ? createCanvasImageResolver(options.images)
    : () => undefined;
  return { resolveImage, ...(colorOverride ? { colorOverride } : {}) };
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
      paintPage(ctx, command.paint.backgroundColor, command.rect, state.colorOverride);
      break;
    case 'paintBlock':
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
  colorOverride: CanvasRenderState['colorOverride'],
): void {
  if (!backgroundColor) return;
  // An active theme override owns the page ground (see the browser
  // frame-command renderer, which this reference mirrors).
  ctx.fillStyle = colorOverride ? colorOverride.backgroundColor : backgroundColor;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
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
