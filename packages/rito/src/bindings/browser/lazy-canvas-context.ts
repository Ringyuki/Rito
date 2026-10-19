import type { CanvasRenderingTarget } from './primitive-renderer';

/**
 * The canvas's 2D context, taken the first time the reader paints into the
 * canvas itself: a host that has the reader paint elsewhere may want the
 * canvas for WebGL.
 */
export function lazyCanvasContext(
  canvas: HTMLCanvasElement | OffscreenCanvas,
): () => CanvasRenderingTarget {
  let context: CanvasRenderingTarget | undefined;
  return () => {
    context ??= (canvas.getContext('2d') as CanvasRenderingTarget | null) ?? undefined;
    if (!context)
      throw new Error('Rito reader core requires a 2D canvas context to paint its canvas');
    return context;
  };
}
