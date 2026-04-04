export interface TransitionDOM {
  readonly wrapper: HTMLDivElement;
  readonly mainCanvas: HTMLCanvasElement;
  readonly snapshotCanvas: HTMLCanvasElement;
}

export function createTransitionDOM(): TransitionDOM {
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.overflow = 'hidden';

  const mainCanvas = document.createElement('canvas');
  mainCanvas.style.display = 'block';

  const snapshotCanvas = document.createElement('canvas');
  snapshotCanvas.style.position = 'absolute';
  snapshotCanvas.style.top = '0';
  snapshotCanvas.style.left = '0';
  snapshotCanvas.style.display = 'none';
  snapshotCanvas.style.willChange = 'transform, opacity';

  wrapper.appendChild(mainCanvas);
  wrapper.appendChild(snapshotCanvas);

  return { wrapper, mainCanvas, snapshotCanvas };
}

export function syncCanvasSize(
  canvas: HTMLCanvasElement,
  width: number,
  height: number,
  dpr: number,
): void {
  canvas.width = Math.round(width * dpr);
  canvas.height = Math.round(height * dpr);
  canvas.style.width = `${String(width)}px`;
  canvas.style.height = `${String(height)}px`;
}
