import { renderFrameCommandsToCanvas, type CanvasRenderingTarget } from './frame-command-renderer';
import { createCanvasImageResolver } from './image-href-resolver';
import type { BrowserReaderFrame, BrowserReaderState } from './reader/types';
import { ensureFrameLoaded, loadFrame, warmBrowserReaderFrameWindow } from './reader/frame-cache';
import { browserReaderSpreads } from './reader-layout';

export type { CanvasRenderingTarget } from './frame-command-renderer';

type CanvasImageResolver = ReturnType<typeof createCanvasImageResolver>;

export function renderSpreadToBoundCanvas(
  state: BrowserReaderState,
  index: number,
  scale: number,
): boolean {
  const effectiveRatio = scale * state.dpr;
  const config = state.config;
  state.canvas.width = Math.round(config.viewportWidth * effectiveRatio);
  state.canvas.height = Math.round(config.viewportHeight * effectiveRatio);
  const painted = renderSpreadToContext(state, index, state.ctx);
  notifySpreadRendered(state, index);
  return painted;
}

export function renderSpreadToContext(
  state: BrowserReaderState,
  index: number,
  ctx: CanvasRenderingTarget,
): boolean {
  const frame = loadFrame(state, index);
  if (!frame) {
    void ensureFrameLoaded(state, index);
    return false;
  }
  const resolveImage = createCanvasImageResolver(state.images);
  preloadMissingFrameImages(state, index, frame, resolveImage);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  paintBackground(ctx, state.bgColor);
  renderFrameToCanvas(ctx, frame, state, resolveImage);
  return true;
}

export function notifySpreadRendered(state: BrowserReaderState, index: number): void {
  state.activeSpreadIndex = index;
  const spread = browserReaderSpreads(state)[index];
  if (!spread) return;
  for (const cb of state.spreadRenderedListeners) cb(index, spread);
}

function paintBackground(ctx: CanvasRenderingTarget, color: string): void {
  if (!color) return;
  const canvasCtx = ctx as CanvasRenderingContext2D;
  canvasCtx.save();
  canvasCtx.fillStyle = color;
  canvasCtx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  canvasCtx.restore();
}

function preloadMissingFrameImages(
  state: BrowserReaderState,
  index: number,
  frame: BrowserReaderFrame,
  resolveImage: CanvasImageResolver,
): void {
  if (typeof createImageBitmap === 'undefined') return;
  for (const href of frame.resourceRefs.images) {
    if (resolveImage(href) === undefined) {
      void warmBrowserReaderFrameWindow(state, index);
      return;
    }
  }
}

function renderFrameToCanvas(
  ctx: CanvasRenderingTarget,
  frame: BrowserReaderFrame,
  state: BrowserReaderState,
  resolveImage: CanvasImageResolver,
): void {
  const pixelRatio = framePixelRatio(ctx, frame.width, frame.height);
  if (pixelRatio === undefined) return;
  renderFrameCommandsToCanvas(frame.commands, ctx, {
    pixelRatio,
    resolveImage,
    ...(state.fgColor ? { foregroundColor: state.fgColor, backgroundColor: state.bgColor } : {}),
  });
}

function framePixelRatio(
  ctx: CanvasRenderingTarget,
  frameWidth: number,
  frameHeight: number,
): number | undefined {
  if (frameWidth <= 0 || frameHeight <= 0) return undefined;
  const xRatio = ctx.canvas.width / frameWidth;
  const yRatio = ctx.canvas.height / frameHeight;
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) return undefined;
  return Math.abs(xRatio - yRatio) < 0.01 ? xRatio : undefined;
}
