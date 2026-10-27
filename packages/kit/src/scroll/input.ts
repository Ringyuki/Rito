import { estimateVelocity, type VelocitySample } from '../driver/transition-velocity';
import type { ScrollController } from './types';

/** CSS pixels a wheel's line moves; a page moves the viewport less two lines. */
const LINE = 40;

/**
 * The built-in input: the wheel and the keys move the strip, a touch or a
 * pen drags it and flings it. Forward is down the screen, or leftwards for
 * a book that scrolls leftwards. Returns the unsubscribe.
 */
export function wireScrollInput(
  canvas: HTMLCanvasElement,
  controller: ScrollController,
): () => void {
  const stopKeys = wireWheelAndKeys(canvas, controller);
  const stopDrag = wireDrag(canvas, controller);
  return () => {
    stopKeys();
    stopDrag();
  };
}

function wireWheelAndKeys(canvas: HTMLCanvasElement, controller: ScrollController): () => void {
  const page = (): number =>
    (controller.axis === 'left' ? canvas.clientWidth : canvas.clientHeight) - 2 * LINE;
  const onWheel = (event: WheelEvent): void => {
    event.preventDefault();
    const scale = event.deltaMode === 1 ? LINE : event.deltaMode === 2 ? page() : 1;
    const forward = controller.axis === 'left' ? event.deltaY - event.deltaX : event.deltaY;
    controller.scrollBy(forward * scale);
  };
  const left = (): boolean => controller.axis === 'left';
  const keys: Record<string, () => number> = {
    ArrowDown: () => (left() ? 0 : LINE),
    ArrowUp: () => (left() ? 0 : -LINE),
    ArrowLeft: () => (left() ? LINE : 0),
    ArrowRight: () => (left() ? -LINE : 0),
    PageDown: page,
    ' ': page,
    PageUp: () => -page(),
    Home: () => -controller.offset,
    End: () => controller.extent,
  };
  const onKey = (event: KeyboardEvent): void => {
    const move = keys[event.key]?.();
    if (move === undefined || move === 0 || event.defaultPrevented) return;
    event.preventDefault();
    controller.scrollBy(event.key === ' ' && event.shiftKey ? -move : move, { animate: true });
  };
  canvas.addEventListener('wheel', onWheel, { passive: false });
  window.addEventListener('keydown', onKey);
  return () => {
    canvas.removeEventListener('wheel', onWheel);
    window.removeEventListener('keydown', onKey);
  };
}

function wireDrag(canvas: HTMLCanvasElement, controller: ScrollController): () => void {
  let samples: VelocitySample[] = [];
  let last: { readonly x: number; readonly y: number } | undefined;
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType === 'mouse' || !event.isPrimary) return;
    canvas.setPointerCapture(event.pointerId);
    controller.grab();
    last = { x: event.clientX, y: event.clientY };
    samples = [{ dx: 0, timestamp: event.timeStamp }];
  };
  const onMove = (event: PointerEvent): void => {
    if (last === undefined || !event.isPrimary) return;
    const delta = controller.axis === 'left' ? event.clientX - last.x : last.y - event.clientY;
    last = { x: event.clientX, y: event.clientY };
    const travelled = (samples.at(-1)?.dx ?? 0) + delta;
    samples = [...samples, { dx: travelled, timestamp: event.timeStamp }].slice(-5);
    controller.follow(delta);
  };
  const onUp = (event: PointerEvent): void => {
    if (last === undefined || !event.isPrimary) return;
    last = undefined;
    controller.release(estimateVelocity(samples) * 1000);
  };
  const events = [
    ['pointerdown', onDown],
    ['pointermove', onMove],
    ['pointerup', onUp],
    ['pointercancel', onUp],
  ] as const;
  for (const [name, handler] of events) canvas.addEventListener(name, handler);
  return () => {
    for (const [name, handler] of events) canvas.removeEventListener(name, handler);
  };
}
