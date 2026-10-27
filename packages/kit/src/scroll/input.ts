import { wireDrag } from './touch-input';
import type { ScrollController } from './types';

/** CSS pixels a wheel's line moves; a page moves the viewport less two lines. */
const LINE = 40;

/** A tap at view coordinates (CSS pixels from the view's top-left corner). */
export type ScrollTap = (x: number, y: number) => void;

/** What a touch held still and selecting does as it moves and lifts, at view coordinates. */
export interface TouchSelecting {
  move(x: number, y: number): void;
  end(x: number, y: number): void;
}

/** Starts a selection at view point `x`, `y` for a touch held still; null when it cannot. */
export type ScrollLongPress = (x: number, y: number) => TouchSelecting | null;

/**
 * The built-in input: the wheel and the keys move the strip, a touch or a
 * pen drags it and flings it, a touch held still selects through
 * `longPress`, and a click taps unless `mouseTaps` is off (the mouse's
 * selection taps instead). Forward is down the screen, or leftwards for a
 * book that scrolls leftwards. Returns the unsubscribe.
 */
export function wireScrollInput(
  canvas: HTMLCanvasElement,
  controller: ScrollController,
  tap: ScrollTap,
  options: { readonly mouseTaps?: boolean; readonly longPress?: ScrollLongPress } = {},
): () => void {
  const stopKeys = wireWheelAndKeys(canvas, controller);
  const stopDrag = wireDrag(canvas, controller, tap, options.longPress);
  const onClick = (event: MouseEvent): void => {
    const rect = canvas.getBoundingClientRect();
    tap(event.clientX - rect.left, event.clientY - rect.top);
  };
  const clicks = options.mouseTaps ?? true;
  if (clicks) canvas.addEventListener('click', onClick);
  return () => {
    stopKeys();
    stopDrag();
    if (clicks) canvas.removeEventListener('click', onClick);
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
