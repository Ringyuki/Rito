import type { Reader } from '../../../reader';
import type { ReaderGlTarget } from '../gl-pen/target';
import type { CanvasRenderingTarget } from '../primitive-renderer';
import { ensureSessionReaderFrame } from './frames';
import { scheduleSessionReaderShow } from './foreground';
import type { SessionReaderFrame, SessionReaderState } from './state';

export function sessionReaderRenderingMethods(
  state: SessionReaderState,
): Pick<Reader, 'renderSpread' | 'renderSpreadTo' | 'notifyActiveSpread' | 'getCanvasSize'> {
  return {
    renderSpread(index, scale = 1) {
      const ratio = scale * state.dpr;
      state.canvas.width = Math.round(state.config.viewportWidth * ratio);
      state.canvas.height = Math.round(state.config.viewportHeight * ratio);
      if (renderSessionReaderSpread(state, index, state.canvasContext())) showSpread(state, index);
    },
    renderSpreadTo(index, target) {
      return renderSessionReaderSpread(state, index, target);
    },
    notifyActiveSpread(index) {
      showSpread(state, index);
    },
    getCanvasSize(scale = 1) {
      return {
        width: Math.round(state.config.viewportWidth * scale * state.dpr) / state.dpr,
        height: Math.round(state.config.viewportHeight * scale * state.dpr) / state.dpr,
      };
    },
  };
}

/** Records the spread the host shows, tells its listeners and has the session follow. */
function showSpread(state: SessionReaderState, index: number): void {
  const spread = state.view.spreads[index];
  if (spread === undefined || state.disposed) return;
  state.activeSpreadIndex = index;
  for (const listener of state.spreadRenderedListeners) listener(index, spread);
  scheduleSessionReaderShow(state);
}

/**
 * Paints a loaded spread. One that is not loaded starts loading and
 * reports false; its arrival invalidates the spread, which is the host's
 * cue to paint it again.
 */
function renderSessionReaderSpread(
  state: SessionReaderState,
  index: number,
  target: CanvasRenderingTarget | ReaderGlTarget,
): boolean {
  if (state.disposed) return false;
  const frame = state.frames.get(index);
  if (frame === undefined) {
    void ensureSessionReaderFrame(state, index);
    return false;
  }
  return paintFrame(state, frame, target);
}

function paintFrame(
  state: SessionReaderState,
  frame: SessionReaderFrame,
  target: CanvasRenderingTarget | ReaderGlTarget,
): boolean {
  const { width, height } = frame.artifact;
  const size = 'gl' in target ? target : target.canvas;
  const targetRatio = pixelRatioOf(size.width, size.height, width, height);
  if (targetRatio === undefined) return false;
  // The artifact's paint is resolved on the device grid at its own
  // ratio; a target on that grid takes it as it is, and any other (a
  // host zoom) takes it uniformly scaled.
  const ratio = frame.prepared.ratio;
  const onGrid =
    Math.round(width * ratio) === size.width && Math.round(height * ratio) === size.height;
  const options = {
    ground: state.bgColor || undefined,
    backgroundColor: state.bgColor,
    ...(state.fgColor === undefined ? {} : { foregroundColor: state.fgColor }),
    scale: onGrid ? 1 : targetRatio / ratio,
  };
  if ('gl' in target) return state.presenter.paintGl(frame.prepared, target, options);
  state.presenter.paint(frame.prepared, target, options);
  return true;
}

/** Device pixels per CSS pixel of a target shaped like the spread; undefined for another shape. */
function pixelRatioOf(
  targetWidth: number,
  targetHeight: number,
  width: number,
  height: number,
): number | undefined {
  if (width <= 0 || height <= 0) return undefined;
  const xRatio = targetWidth / width;
  const yRatio = targetHeight / height;
  if (!Number.isFinite(xRatio) || !Number.isFinite(yRatio)) return undefined;
  return Math.abs(xRatio - yRatio) < 0.01 ? xRatio : undefined;
}
