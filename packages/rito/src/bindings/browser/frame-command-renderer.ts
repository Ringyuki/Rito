import type { CoreFrameCommand } from './core-contracts';
import { renderCanvasBlockDecoration } from './canvas-block/renderer';
import { traceRoundedRect } from './canvas-path';
import { drawCanvasRubyFragment, drawCanvasTextFragment } from './canvas-text/renderer';
import type { CanvasTextColorOverride } from './canvas-text/types';

export type CanvasRenderingTarget = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
type CanvasContext = CanvasRenderingContext2D;
type BlockCommand = Extract<CoreFrameCommand, { readonly kind: 'paintBlock' }>;
type TextCommand = Extract<CoreFrameCommand, { readonly kind: 'paintText' }>;
type RubyCommand = Extract<CoreFrameCommand, { readonly kind: 'paintRuby' }>;
type ImageCommand = Extract<CoreFrameCommand, { readonly kind: 'paintImage' }>;
type HorizontalRuleCommand = Extract<CoreFrameCommand, { readonly kind: 'paintHorizontalRule' }>;
type TransformCommand = Extract<CoreFrameCommand, { readonly kind: 'transform' }>;
type TranslateTransform = Extract<
  TransformCommand['transforms'][number],
  { readonly kind: 'translate' }
>;
type ClipCommand = Extract<CoreFrameCommand, { readonly kind: 'clipRect' }>;
type FrameCommandImageResolver = (src: string) => ImageBitmap | undefined;

export interface FrameCommandRenderOptions {
  readonly pixelRatio?: number;
  readonly resolveImage?: FrameCommandImageResolver;
  readonly foregroundColor?: string;
  readonly backgroundColor?: string;
}
interface RenderState {
  readonly resolveImage: FrameCommandImageResolver;
  readonly colorOverride?: CanvasTextColorOverride;
  commandSaveDepth: number;
}

export function renderFrameCommandsToCanvas(
  commands: readonly CoreFrameCommand[],
  ctx: CanvasRenderingTarget,
  options: FrameCommandRenderOptions,
): void {
  const canvasCtx = ctx as CanvasRenderingContext2D;
  const state = createRenderState(options);
  canvasCtx.save();
  try {
    canvasCtx.scale(options.pixelRatio ?? 1, options.pixelRatio ?? 1);
    for (const command of commands) renderCommand(canvasCtx, command, state);
  } finally {
    while (state.commandSaveDepth > 0) {
      canvasCtx.restore();
      state.commandSaveDepth -= 1;
    }
    canvasCtx.restore();
  }
}

function createRenderState(options: FrameCommandRenderOptions): RenderState {
  const colorOverride =
    options.foregroundColor !== undefined && options.backgroundColor !== undefined
      ? {
          foregroundColor: options.foregroundColor,
          backgroundColor: options.backgroundColor,
        }
      : undefined;
  return {
    resolveImage: options.resolveImage ?? (() => undefined),
    commandSaveDepth: 0,
    ...(colorOverride ? { colorOverride } : {}),
  };
}

function renderCommand(ctx: CanvasContext, command: CoreFrameCommand, state: RenderState): void {
  switch (command.kind) {
    case 'pushState':
      ctx.save();
      state.commandSaveDepth += 1;
      return;
    case 'popState':
      if (state.commandSaveDepth === 0) {
        throw new Error('Frame command popState has no matching pushState.');
      }
      ctx.restore();
      state.commandSaveDepth -= 1;
      return;
    case 'translate':
      ctx.translate(command.dx, command.dy);
      return;
    case 'transform':
      applyTransform(ctx, command);
      return;
    case 'opacity':
      ctx.globalAlpha = (Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1) * command.value;
      return;
    case 'clipRect':
      applyClipRect(ctx, command);
      return;
    case 'paintPage':
      paintPage(ctx, command.paint.backgroundColor, command.rect);
      return;
    case 'paintBlock':
      paintBlock(ctx, command, state);
      return;
    case 'paintText':
      paintText(ctx, command, state);
      return;
    case 'paintRuby':
      paintRuby(ctx, command, state);
      return;
    case 'paintImage':
      paintImage(ctx, command, state.resolveImage);
      return;
    case 'paintHorizontalRule':
      paintHorizontalRule(ctx, command);
      return;
    default:
      return assertNever(command);
  }
}

function applyClipRect(ctx: CanvasRenderingContext2D, command: ClipCommand): void {
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
  rect: Extract<CoreFrameCommand, { readonly kind: 'paintPage' }>['rect'],
): void {
  if (!backgroundColor) return;
  ctx.fillStyle = backgroundColor;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

function paintBlock(
  ctx: CanvasRenderingContext2D,
  command: BlockCommand,
  state: RenderState,
): void {
  renderCanvasBlockDecoration(ctx, command, state.resolveImage);
}

function paintText(ctx: CanvasRenderingContext2D, command: TextCommand, state: RenderState): void {
  drawCanvasTextFragment(
    ctx,
    { text: command.text, rect: command.rect, paint: command.paint },
    state.colorOverride,
  );
}

function paintRuby(ctx: CanvasRenderingContext2D, command: RubyCommand, state: RenderState): void {
  drawCanvasRubyFragment(
    ctx,
    { text: command.text, rect: command.rect, paint: command.paint },
    state.colorOverride,
  );
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  command: ImageCommand,
  resolveImage: FrameCommandImageResolver,
): void {
  const bitmap = resolveImage(command.src);
  if (!bitmap) return;
  const { rect } = command;
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
}

function paintHorizontalRule(ctx: CanvasRenderingContext2D, command: HorizontalRuleCommand): void {
  const { rect, paint } = command;
  const rawY = rect.y + rect.height / 2;
  const y = Math.round(rawY) + (rect.height % 2 === 1 ? 0.5 : 0);
  ctx.save();
  try {
    ctx.strokeStyle = paint.color;
    ctx.lineWidth = paint.style === 'dotted' ? rect.height * 0.75 : rect.height;
    if (paint.style === 'dotted') {
      ctx.setLineDash([0.001, rect.height * 1.5]);
      ctx.lineCap = 'round';
    } else if (paint.style === 'dashed') {
      ctx.setLineDash([rect.height * 3, rect.height * 2]);
    }
    ctx.beginPath();
    ctx.moveTo(Math.round(rect.x), y);
    ctx.lineTo(Math.round(rect.x + rect.width), y);
    ctx.stroke();
  } finally {
    ctx.restore();
  }
}

function applyTransform(ctx: CanvasRenderingContext2D, command: TransformCommand): void {
  const { origin, box } = command;
  ctx.translate(origin.x, origin.y);
  for (const transform of command.transforms) {
    if (transform.kind === 'rotate') ctx.rotate(transform.rad);
    else if (transform.kind === 'scale') ctx.scale(transform.sx, transform.sy);
    else {
      ctx.translate(
        resolveLengthPercentage(transform.x, box.width),
        resolveLengthPercentage(transform.y, box.height),
      );
    }
  }
  ctx.translate(-origin.x, -origin.y);
}

function resolveLengthPercentage(value: TranslateTransform['x'], basis: number): number {
  return value.unit === 'percent' ? (value.value / 100) * basis : value.value;
}

function assertNever(value: never): never {
  throw new Error(`Unsupported frame command: ${JSON.stringify(value)}`);
}
