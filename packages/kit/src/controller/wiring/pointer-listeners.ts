export interface PointerListenerSet {
  readonly down: (event: PointerEvent) => void;
  readonly mouseDown: (event: MouseEvent) => void;
  readonly move: (event: PointerEvent) => void;
  readonly up: (event: PointerEvent) => void;
  readonly cancel: (event: PointerEvent) => void;
  readonly lostCapture: (event: PointerEvent) => void;
}

/** Install and remove the complete pointer-selection listener set atomically. */
export function installPointerListeners(
  canvas: HTMLCanvasElement,
  listeners: PointerListenerSet,
  onRemove: () => void,
): () => void {
  const remove = (): void => {
    canvas.removeEventListener('pointerdown', listeners.down);
    canvas.removeEventListener('mousedown', listeners.mouseDown);
    canvas.removeEventListener('pointermove', listeners.move);
    canvas.removeEventListener('pointerup', listeners.up);
    canvas.removeEventListener('pointercancel', listeners.cancel);
    canvas.removeEventListener('lostpointercapture', listeners.lostCapture);
    onRemove();
  };
  try {
    canvas.addEventListener('pointerdown', listeners.down);
    canvas.addEventListener('mousedown', listeners.mouseDown);
    canvas.addEventListener('pointermove', listeners.move);
    canvas.addEventListener('pointerup', listeners.up);
    canvas.addEventListener('pointercancel', listeners.cancel);
    canvas.addEventListener('lostpointercapture', listeners.lostCapture);
    return remove;
  } catch (error: unknown) {
    remove();
    throw error;
  }
}
