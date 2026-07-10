import {
  canvasDisplayListRenderer,
  createCanvasImageResolver,
} from '../../reference/ts-core/render/backends/canvas';
import type { DisplayList, DrawCommand } from '../../reference/ts-core/render/display-list';
import type { BrowserReaderFrame, BrowserReaderState } from './reader/types';
import { ensureFrameLoaded, loadFrame, warmBrowserReaderFrameWindow } from './reader/frame-cache';
import { browserReaderSpreads } from './reader/layout';
import { visualLayoutConfig, visualPreviewFrame } from './reader/revision';

export type CanvasRenderingTarget = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

export function renderSpreadToBoundCanvas(
  state: BrowserReaderState,
  index: number,
  scale: number,
): boolean {
  const effectiveRatio = scale * state.dpr;
  const config = visualLayoutConfig(state);
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
  const frame = visualPreviewFrame(state, index) ?? loadFrame(state, index);
  if (!frame) {
    void ensureFrameLoaded(state, index);
    return false;
  }
  preloadMissingFrameImages(state, index, frame, frame === visualPreviewFrame(state, index));
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  paintBackground(ctx, state.bgColor);
  renderFrameToCanvas(ctx, frame, state);
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
  usesVisualPreview: boolean,
): void {
  if (typeof createImageBitmap === 'undefined') return;
  const resolveImage = createCanvasImageResolver(state.images);
  for (const href of frame.resourceRefs.images) {
    if (resolveImage(href) === undefined) {
      if (usesVisualPreview) return;
      void warmBrowserReaderFrameWindow(state, index);
      return;
    }
  }
}

function renderFrameToCanvas(
  ctx: CanvasRenderingTarget,
  frame: BrowserReaderFrame,
  state: BrowserReaderState,
): void {
  const displayList = toDisplayList(frame);
  const pixelRatio = framePixelRatio(ctx, displayList.width, displayList.height);
  if (pixelRatio === undefined) return;
  canvasDisplayListRenderer.render(displayList, ctx, {
    pixelRatio,
    images: state.images,
    ...(state.fgColor ? { foregroundColor: state.fgColor, backgroundColor: state.bgColor } : {}),
  });
}

function toDisplayList(frame: BrowserReaderFrame): DisplayList {
  return {
    width: frame.width,
    height: frame.height,
    commands: frame.commands as unknown as readonly DrawCommand[],
  };
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
