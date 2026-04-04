import { getSpreadDimensions, render } from '../../render/spread';
import type { ReaderState } from './types';

export function renderSpreadToCanvas(
  state: ReaderState,
  canvas: HTMLCanvasElement | OffscreenCanvas,
  ctx: CanvasRenderingContext2D,
  index: number,
  scale: number,
): void {
  if (index < 0 || index >= state.spreads.length) {
    state.logger.warn(
      `renderSpread: index ${String(index)} out of range [0, ${String(state.spreads.length)})`,
    );
    return;
  }

  const spread = state.spreads[index];
  if (!spread) return;

  const effectiveRatio = scale * state.dpr;
  const dims = getSpreadDimensions(state.config, effectiveRatio);
  canvas.width = dims.width;
  canvas.height = dims.height;

  const correctedRatio = canvas.width / state.config.viewportWidth;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  const options: Record<string, unknown> = {
    backgroundColor: state.bgColor,
    pixelRatio: correctedRatio,
    images: state.resources.images,
  };
  if (state.fgColor) options['foregroundColor'] = state.fgColor;
  render(spread, ctx, state.config, options as Parameters<typeof render>[3]);
}
