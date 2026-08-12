import type { CoreFrameCommand } from './core-contracts';
import { renderCanvasBlockDecoration } from './canvas-block/renderer';
import { strokeBorder } from './canvas-block/border-stroke';
import { traceRoundedRect } from './canvas-path';
import { drawCanvasRubyFragment, drawCanvasTextFragment } from './canvas-text/renderer';
import type { CanvasTextColorOverride } from './canvas-text/types';
import { isBookOwnedPageGround, isOpaqueColor } from './theme/text-color';

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
type FrameCommandImageResolver = (src: string) => CanvasImageSource | undefined;

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
  // Declared-ground tracking for the theme override (R1/R2): opaque
  // block backgrounds replayed so far, and the page ground when R1 kept
  // the book's own color. Reset by every paintPage command. Both pens
  // accumulate and search these the same way or parity drifts.
  readonly blockGrounds: { readonly rect: TextCommand['rect']; readonly color: string }[];
  bookOwnedPageGround: string | undefined;
}

export function renderFrameCommandsToCanvas(
  commands: readonly CoreFrameCommand[],
  ctx: CanvasRenderingTarget,
  options: FrameCommandRenderOptions,
): void {
  const canvasCtx = ctx as CanvasRenderingContext2D;
  const state = createRenderState(options);
  // Session-scoped tap for paint-parity instruments (pixel-walk probes):
  // observes the exact command stream without altering rendering. The
  // second argument tells probes whether this canvas is the on-screen one
  // — spread pre-renders replay the same commands into offscreen
  // canvases, and a probe that cannot tell them apart records the wrong
  // spread.
  const paintTap = (
    globalThis as { __ritoPaintTap?: (c: CoreFrameCommand, onScreen: boolean) => void }
  ).__ritoPaintTap;
  const onScreen =
    typeof (canvasCtx.canvas as { isConnected?: boolean }).isConnected === 'boolean'
      ? (canvasCtx.canvas as unknown as { isConnected: boolean }).isConnected
      : false;
  let rendered = 0;
  let failed = 0;
  let firstFailure: unknown;
  canvasCtx.save();
  try {
    canvasCtx.scale(options.pixelRatio ?? 1, options.pixelRatio ?? 1);
    for (const command of commands) {
      paintTap?.(command, onScreen);
      // Paint faults are isolated per command: one bad command must not
      // truncate the frame — and it must never propagate, because an
      // exception escaping the paint path leaves the spread permanently
      // "not ready" and paging into it hangs (a rotated shadowed run
      // once wedged a whole book's navigation this way). The fault is
      // recorded loudly instead; the canvas keeps everything else.
      const entryDepth = state.commandSaveDepth;
      try {
        renderCommand(canvasCtx, command, state);
      } catch (error) {
        failed += 1;
        firstFailure ??= error;
        recordRenderFailure(error, command, rendered, commands.length);
        while (state.commandSaveDepth > entryDepth) {
          canvasCtx.restore();
          state.commandSaveDepth -= 1;
        }
      }
      rendered += 1;
    }
  } finally {
    while (state.commandSaveDepth > 0) {
      canvasCtx.restore();
      state.commandSaveDepth -= 1;
    }
    canvasCtx.restore();
  }
  if (failed > 0) {
    console.error(
      `[rito] frame rendered degraded: ${String(failed)}/${String(commands.length)} paint ` +
        `commands failed (details in globalThis.__ritoRenderFailures)`,
      firstFailure,
    );
  }
}

/** Publish a paint fault for support diagnostics, keeping the last few. */
function recordRenderFailure(
  error: unknown,
  command: CoreFrameCommand,
  commandIndex: number,
  totalCommands: number,
): void {
  const scope = globalThis as { __ritoRenderFailures?: unknown[] };
  const failedCommand: unknown = (() => {
    try {
      return JSON.parse(JSON.stringify(command)) as unknown;
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
  rect: TextCommand['rect'],
  paint: { readonly backgroundColor?: string },
  state: RenderState,
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
      paintPage(ctx, command.paint.backgroundColor, command.rect, state);
      return;
    case 'paintBlock':
      trackBlockGround(command, state);
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
  state: RenderState,
): void {
  if (!backgroundColor) return;
  state.blockGrounds.length = 0;
  state.bookOwnedPageGround = undefined;
  // R1, page-ground ownership: a designed ground (opaque and darker
  // than the white-paper limit) is a choice the book expressed — keep
  // it and mark the page book-owned. Near-white/unstated grounds are
  // the typesetter's white-paper default assumption; the theme takes
  // those over. Absent commands stay absent — the override never
  // invents a page fill.
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

function trackBlockGround(command: BlockCommand, state: RenderState): void {
  const color = command.paint.background?.color;
  if (color !== undefined && isOpaqueColor(color)) {
    state.blockGrounds.push({ rect: command.rect, color });
  }
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
    declaredGroundFor(command.rect, command.paint, state),
  );
}

function paintRuby(ctx: CanvasRenderingContext2D, command: RubyCommand, state: RenderState): void {
  drawCanvasRubyFragment(
    ctx,
    { text: command.text, rect: command.rect, paint: command.paint },
    state.colorOverride,
    declaredGroundFor(command.rect, command.paint, state),
  );
}

function paintImage(
  ctx: CanvasRenderingContext2D,
  command: ImageCommand,
  resolveImage: FrameCommandImageResolver,
): void {
  const bitmap = resolveImage(command.src);
  if (!bitmap) return;
  const { rect, sourceRect } = command;
  // The rect arrives pre-snapped where Blink snaps (plain replaced
  // images; SVG-folded content stays fractional) — see the engine's
  // append_image_command. A sourceRect samples only that raster region
  // — the clamp-bleed strip an svg letterbox smears across its sliver.
  if (sourceRect) {
    ctx.drawImage(
      bitmap,
      sourceRect.x,
      sourceRect.y,
      sourceRect.width,
      sourceRect.height,
      rect.x,
      rect.y,
      rect.width,
      rect.height,
    );
    return;
  }
  ctx.drawImage(bitmap, rect.x, rect.y, rect.width, rect.height);
}

function paintHorizontalRule(ctx: CanvasRenderingContext2D, command: HorizontalRuleCommand): void {
  const { rect, paint } = command;
  // A styled rule is a border edge in Blink (the <hr>'s border-top), so
  // dotted/dashed/double stroke through the same measured border model
  // as block borders — binary dot raster and the double pair included.
  if (paint.style !== 'solid') {
    const edge = { width: rect.height, color: paint.color, style: paint.style };
    const centerY = rect.y + rect.height / 2;
    ctx.save();
    try {
      strokeBorder(ctx, edge, rect.x, centerY, rect.x + rect.width, centerY);
    } finally {
      ctx.restore();
    }
    return;
  }
  const rawY = rect.y + rect.height / 2;
  const y = Math.round(rawY) + (rect.height % 2 === 1 ? 0.5 : 0);
  ctx.save();
  try {
    ctx.strokeStyle = paint.color;
    ctx.lineWidth = rect.height;
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
