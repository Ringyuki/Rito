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
  publishFrameDiagnostics(frame, ctx, state, pixelRatio);
  try {
    renderFrameCommandsToCanvas(frame.commands, ctx, {
      pixelRatio,
      resolveImage,
      ...(state.fgColor ? { foregroundColor: state.fgColor, backgroundColor: state.bgColor } : {}),
    });
  } catch (error) {
    const scope = globalThis as { __ritoLastRenderError?: unknown };
    scope.__ritoLastRenderError = {
      spreadIndex: frame.spreadIndex,
      message: String(error),
      stack: error instanceof Error ? error.stack?.slice(0, 600) : undefined,
      at: new Date().toISOString(),
    };
    throw error;
  }
}

/**
 * Best-effort frame identity for support diagnostics: every painted frame
 * publishes what it was, so a wrong-looking canvas can be attributed to an
 * exact engine frame from the console without instrumented builds.
 */
function publishFrameDiagnostics(
  frame: BrowserReaderFrame,
  ctx: CanvasRenderingTarget,
  state: BrowserReaderState,
  pixelRatio: number,
): void {
  const scope = globalThis as { __ritoLastFrame?: unknown };
  const texts: string[] = [];
  const families: string[] = [];
  for (const command of frame.commands) {
    if (command.kind === 'paintText' && typeof command.text === 'string') {
      texts.push(command.text);
      if (families.length === 0) {
        families.push(JSON.stringify(command).slice(0, 400));
      }
      if (texts.length >= 3) break;
    }
  }
  const canvas = ctx.canvas as Partial<HTMLCanvasElement> & { __ritoCanvasId?: number };
  const idScope = globalThis as { __ritoCanvasCounter?: number };
  canvas.__ritoCanvasId ??= idScope.__ritoCanvasCounter = (idScope.__ritoCanvasCounter ?? 0) + 1;
  const logScope = globalThis as { __ritoFrameLog?: unknown[] };
  scope.__ritoLastFrame = {
    revisionId: frame.revisionId,
    spreadIndex: frame.spreadIndex,
    commandCount: frame.commands.length,
    commandCounts: frame.commands.reduce<Record<string, number>>((acc, command) => {
      acc[command.kind] = (acc[command.kind] ?? 0) + 1;
      return acc;
    }, {}),
    firstTexts: texts,
    firstFamilies: families,
    frameSize: { width: frame.width, height: frame.height },
    canvasSize: { width: ctx.canvas.width, height: ctx.canvas.height },
    canvasCssSize: {
      width: canvas.clientWidth ?? null,
      height: canvas.clientHeight ?? null,
    },
    pixelRatio,
    stateDpr: state.dpr,
    paginationBackend: state.revisionBundle.revision.paginationBackend ?? null,
    fragmentPaginationLever: state.fragmentPagination,
    revisionStatus: state.revisionBundle.revision.status,
    revisionVersion: state.revisionBundle.revision.revisionVersion,
    canvasId: canvas.__ritoCanvasId,
    offscreen:
      typeof HTMLCanvasElement === 'undefined' || !(ctx.canvas instanceof HTMLCanvasElement),
    at: new Date().toISOString(),
  };
  logScope.__ritoFrameLog = [...(logScope.__ritoFrameLog ?? []).slice(-19), scope.__ritoLastFrame];
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
