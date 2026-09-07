import type { RitoReaderPrimitiveListV1, RitoReaderPrimitiveV1 } from '@ritojs/core-wasm/decoder';

import { renderCanvasBlockDecoration } from './canvas-block/renderer';
import { drawCanvasRubyFragment, drawCanvasTextFragment } from './canvas-text/renderer';
import type { CanvasTextColorOverride } from './canvas-text/types';
import {
  declaredGroundFor,
  recordRenderFailure,
  type DeclaredGrounds,
  type FrameCommandImageResolver,
} from './frame-command-renderer';
import { applyTransform, drawImage, drawShadow, strokePath, tracePath } from './primitive-blits';
import {
  convertReaderBlockV1,
  convertReaderRubyV1,
  convertReaderTextV1,
  toCanvasColorV1,
} from './reader-v1-canvas-converter';
import { isBookOwnedPageGround, isOpaqueColor } from './theme/text-color';

type Primitive = RitoReaderPrimitiveV1;
type FillRectPrimitive = Extract<Primitive, { readonly kind: 'fill-rect' }>;
type PassthroughPrimitive = Extract<Primitive, { readonly kind: 'text' | 'ruby' | 'block' }>;

export interface PrimitiveRenderOptions {
  readonly resolveImage?: FrameCommandImageResolver;
  readonly foregroundColor?: string;
  readonly backgroundColor?: string;
}

interface RenderState extends DeclaredGrounds {
  readonly resolveImage: FrameCommandImageResolver;
  readonly colorOverride?: CanvasTextColorOverride;
  saveDepth: number;
}

/**
 * Blits a device-resolved primitive list. The canvas is assumed to be
 * device-sized with an identity transform: every coordinate lands on the
 * device grid as the engine resolved it, nothing here measures or snaps.
 * Text runs and pass-through blocks go to the semantic painters with
 * their lengths already in device pixels.
 */
export function renderReaderPrimitivesToCanvas(
  list: RitoReaderPrimitiveListV1,
  ctx: CanvasRenderingContext2D,
  options: PrimitiveRenderOptions = {},
): void {
  const state = createRenderState(options);
  let rendered = 0;
  let failed = 0;
  let firstFailure: unknown;
  ctx.save();
  try {
    for (const primitive of list.commands) {
      // A paint fault is isolated per primitive and never propagates:
      // the same degrade-not-block rule as the semantic renderer.
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
    case 'fill-rect':
      fillRect(ctx, primitive, state);
      return;
    case 'fill-path':
      ctx.fillStyle = toCanvasColorV1(primitive.color);
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
    case 'block':
      renderPassthrough(ctx, primitive, state);
      return;
    default:
      return assertNever(primitive);
  }
}

/** A fill that declares the page ground resets the declared grounds and
 * takes the theme's R1 decision: a designed ground (opaque, darker than
 * the white-paper limit) stays the book's and marks the page book-owned;
 * a near-white ground is the typesetter's paper default and the theme
 * paints its own. A fill that declares a block ground is recorded for
 * the ink typeset over it (the engine only declares opaque ones). */
function fillRect(
  ctx: CanvasRenderingContext2D,
  primitive: FillRectPrimitive,
  state: RenderState,
): void {
  const color = toCanvasColorV1(primitive.color);
  let fill = color;
  if (primitive.ground === 'page') {
    state.blockGrounds.length = 0;
    state.bookOwnedPageGround = undefined;
    if (state.colorOverride) {
      if (isBookOwnedPageGround(color)) state.bookOwnedPageGround = color;
      else fill = state.colorOverride.backgroundColor;
    }
  } else if (primitive.ground === 'block') {
    state.blockGrounds.push({ rect: primitive.rect, color });
  }
  const { rect } = primitive;
  ctx.fillStyle = fill;
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
}

/** Text runs and unlowered blocks go to the semantic painters with their
 * lengths already in device pixels. */
function renderPassthrough(
  ctx: CanvasRenderingContext2D,
  primitive: PassthroughPrimitive,
  state: RenderState,
): void {
  if (primitive.kind === 'block') {
    const command = convertReaderBlockV1(primitive);
    const color = command.paint.background?.color;
    if (color !== undefined && isOpaqueColor(color)) {
      state.blockGrounds.push({ rect: command.rect, color });
    }
    renderCanvasBlockDecoration(ctx, command, state.resolveImage);
    return;
  }
  if (primitive.kind === 'text') {
    const command = convertReaderTextV1(primitive);
    drawCanvasTextFragment(
      ctx,
      { text: command.text, rect: command.rect, paint: command.paint },
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
    },
    state.colorOverride,
    declaredGroundFor(command.rect, command.paint, state),
  );
}

function assertNever(value: never): never {
  throw new Error(`Unsupported reader primitive: ${JSON.stringify(value)}`);
}
