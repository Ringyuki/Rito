import { renderFrameCommandsToCanvas, type CanvasRenderingTarget } from './frame-command-renderer';
import {
  touchBrowserReaderDecodedImages,
  type BrowserReaderDecodedImage,
} from './decoded-image-cache';
import { createCanvasImageResolver } from './image-href-resolver';
import { browserReaderImageResourceFailed, ensureFrameImageResourceLoaded } from './resources';
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
  // A loaded frame ALWAYS paints — progressive rendering, the browser
  // and reading-app norm. Undecoded images are kicked onto both
  // recovery lanes and simply skip their paint command; the settled
  // invalidation repaints the spread with the bitmaps once they land.
  // Gating the paint here instead used to gate NAVIGATION: a page turn
  // onto an image spread silently parked until the user pressed again
  // (web) or forever (a terminally wedged decode). The degraded paint
  // is recorded explicitly below, never silent.
  const pendingImages = pendingFrameImages(state, index, frame, resolveImage);
  if (pendingImages.length > 0) recordDegradedSpreadPaint(index, pendingImages);
  touchBrowserReaderDecodedImages(state.images, frame.resourceRefs.images);
  return { frame, resolveImage };
}

/**
 * Publishes a degraded paint for support diagnostics: which spread
 * painted while which images were still undecoded. Capped, latest last.
 */
function recordDegradedSpreadPaint(spreadIndex: number, pendingImages: readonly string[]): void {
  const scope = globalThis as {
    __ritoDegradedSpreadPaints?: { spreadIndex: number; pending: string[]; at: string }[];
  };
  const log = (scope.__ritoDegradedSpreadPaints ??= []);
  log.push({ spreadIndex, pending: [...pendingImages], at: new Date().toISOString() });
  if (log.length > 40) log.splice(0, log.length - 40);
}

/** Paint a lease-owned frame without routing it through publication spread lookup. */
export function renderBrowserReaderChapterLocalFrameToContext(
  state: BrowserReaderState,
  frame: BrowserReaderFrame,
  images: ReadonlyMap<string, BrowserReaderDecodedImage>,
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

function pendingFrameImages(
  state: BrowserReaderState,
  index: number,
  frame: BrowserReaderFrame,
  resolveImage: CanvasImageResolver,
): string[] {
  const pending: string[] = [];
  for (const href of frame.resourceRefs.images) {
    if (resolveImage(href) === undefined) {
      // A terminally-failed image paints as absence, exactly like the
      // browser: it neither counts as pending nor re-warms (and it must
      // never throw — an exception here rode up the navigation stack and
      // wedged the forward page turn forever on b69's missing 015 plate).
      if (browserReaderImageResourceFailed(state, href)) continue;
      pending.push(href);
      // Two recovery lanes: the frame window re-warms siblings, and the
      // direct read covers a bitmap the window machinery never delivered
      // (an aborted prefetch, an evicted decode). Without the second lane
      // a degraded paint would never gain its bitmaps.
      ensureFrameImageResourceLoaded(state, href);
      void warmBrowserReaderFrameWindow(state, index);
    }
  }
  return pending;
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
  const runs: { t: string; x: number; y: number; w: number; n: number }[] = [];
  for (const command of frame.commands) {
    if (command.kind === 'paintText' && typeof command.text === 'string') {
      if (texts.length < 3) texts.push(command.text);
      const paint = (command as { paint?: { font?: { family?: unknown } } }).paint;
      const family = paint?.font?.family;
      if (typeof family === 'string' && !families.includes(family)) families.push(family);
      const rect = (command as { rect?: { x?: number; y?: number } }).rect;
      if (runs.length < 300 && rect && typeof rect.x === 'number' && typeof rect.y === 'number') {
        const width = (rect as { width?: number }).width;
        runs.push({
          t: command.text.slice(0, 24),
          x: rect.x,
          y: rect.y,
          w: typeof width === 'number' ? width : 0,
          n: command.text.length,
        });
      }
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
    textRuns: runs,
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
