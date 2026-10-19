/** The screen's device pixels per CSS pixel. */
export function screenRatio(): number {
  const ratio = (globalThis as { devicePixelRatio?: number }).devicePixelRatio;
  return ratio !== undefined && ratio > 0 ? ratio : 1;
}

/** How far a pinch magnifies the page: 1 when it does not. */
export function pinchScale(): number {
  return visualViewportOf()?.scale ?? 1;
}

/**
 * Calls `ratioChanged` with the new ratio whenever the screen's pixel ratio
 * changes (the page zoomed, the window went to another screen), and
 * `pinched` whenever a pinch changes how far the page is magnified.
 * Returns the stop.
 */
export function watchScreen(
  ratioChanged: (ratio: number) => void,
  pinched: () => void,
): () => void {
  let query: MediaQueryList | undefined;
  // A resolution query matches one ratio: asked again at each new one.
  const changed = (): void => {
    query?.removeEventListener('change', changed);
    arm();
    ratioChanged(screenRatio());
  };
  const arm = (): void => {
    if (typeof matchMedia !== 'function') return;
    query = matchMedia(`(resolution: ${String(screenRatio())}dppx)`);
    query.addEventListener('change', changed);
  };
  arm();
  const viewport = visualViewportOf();
  viewport?.addEventListener('resize', pinched);
  return () => {
    query?.removeEventListener('change', changed);
    query = undefined;
    viewport?.removeEventListener('resize', pinched);
  };
}

function visualViewportOf(): VisualViewport | null {
  return (globalThis as { visualViewport?: VisualViewport | null }).visualViewport ?? null;
}
