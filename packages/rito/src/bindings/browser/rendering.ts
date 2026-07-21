import { renderFrameCommandsToCanvas, type CanvasRenderingTarget } from './frame-command-renderer';
import { touchBrowserReaderDecodedImages } from './decoded-image-cache';
import { createCanvasImageResolver } from './image-href-resolver';
import { throwIfBrowserReaderImageResourceFailed } from './resources';
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
  const prepared = prepareSpreadRender(state, index);
  if (!prepared) return false;
  const effectiveRatio = scale * state.dpr;
  const config = state.config;
  state.canvas.width = Math.round(config.viewportWidth * effectiveRatio);
  state.canvas.height = Math.round(config.viewportHeight * effectiveRatio);
  const painted = renderBrowserReaderPreparedFrameToContext(
    state,
    prepared.frame,
    state.ctx,
    prepared.resolveImage,
  );
  if (painted) notifySpreadRendered(state, index);
  return painted;
}

export function renderSpreadToContext(
  state: BrowserReaderState,
  index: number,
  ctx: CanvasRenderingTarget,
): boolean {
  const prepared = prepareSpreadRender(state, index);
  if (!prepared) return false;
  return renderBrowserReaderPreparedFrameToContext(
    state,
    prepared.frame,
    ctx,
    prepared.resolveImage,
  );
}

function prepareSpreadRender(
  state: BrowserReaderState,
  index: number,
): { readonly frame: BrowserReaderFrame; readonly resolveImage: CanvasImageResolver } | undefined {
  const frame = loadFrame(state, index);
  if (!frame) {
    void ensureFrameLoaded(state, index);
    return undefined;
  }
  const resolveImage = createCanvasImageResolver(state.images);
  if (!requiredFrameImagesAreReady(state, index, frame, resolveImage)) return undefined;
  touchBrowserReaderDecodedImages(state.images, frame.resourceRefs.images);
  return { frame, resolveImage };
}

/** Paint a lease-owned frame without routing it through publication spread lookup. */
export function renderBrowserReaderChapterLocalFrameToContext(
  state: BrowserReaderState,
  frame: BrowserReaderFrame,
  images: ReadonlyMap<string, ImageBitmap>,
  ctx: CanvasRenderingTarget,
): boolean {
  const localImage = createCanvasImageResolver(images);
  const globalImage = createCanvasImageResolver(state.images);
  const resolveImage: CanvasImageResolver = (href) => localImage(href) ?? globalImage(href);
  return renderBrowserReaderPreparedFrameToContext(state, frame, ctx, resolveImage);
}

function renderBrowserReaderPreparedFrameToContext(
  state: BrowserReaderState,
  frame: BrowserReaderFrame,
  ctx: CanvasRenderingTarget,
  resolveImage: CanvasImageResolver,
): boolean {
  const pixelRatio = framePixelRatio(ctx, frame.width, frame.height);
  if (pixelRatio === undefined) return false;
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
  paintBackground(ctx, state.bgColor);
  renderFrameToCanvas(ctx, frame, state, resolveImage, pixelRatio);
  return true;
}

export function notifySpreadRendered(state: BrowserReaderState, index: number): void {
  const spread = browserReaderSpreads(state)[index];
  if (!spread) return;
  state.activeSpreadIndex = index;
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

function requiredFrameImagesAreReady(
  state: BrowserReaderState,
  index: number,
  frame: BrowserReaderFrame,
  resolveImage: CanvasImageResolver,
): boolean {
  let ready = true;
  for (const href of frame.resourceRefs.images) {
    if (resolveImage(href) === undefined) {
      throwIfBrowserReaderImageResourceFailed(state, href);
      ready = false;
      void warmBrowserReaderFrameWindow(state, index);
    }
  }
  return ready;
}

function renderFrameToCanvas(
  ctx: CanvasRenderingTarget,
  frame: BrowserReaderFrame,
  state: BrowserReaderState,
  resolveImage: CanvasImageResolver,
  pixelRatio: number,
): void {
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
