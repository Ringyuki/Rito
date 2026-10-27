import { estimateVelocity, type VelocitySample } from '../driver/transition-velocity';
import type { ScrollLongPress, ScrollTap, TouchSelecting } from './input';
import type { ScrollController } from './types';

/** A touch that moves less than this and lifts within TAP_MS is a tap. */
const TAP_SLOP = 8;
const TAP_MS = 400;
/** How long a touch is held still before it selects rather than drags. */
const LONG_PRESS_MS = 350;

interface Touching {
  readonly x: number;
  readonly y: number;
  readonly at: number;
  last: { x: number; y: number };
  samples: VelocitySample[];
  /** Whether it moved past the tap slop: it drags, and selects no more. */
  moved: boolean;
  timer: ReturnType<typeof setTimeout> | undefined;
  selecting: TouchSelecting | null;
}

interface TouchInput {
  readonly canvas: HTMLCanvasElement;
  readonly controller: ScrollController;
  readonly tap: ScrollTap;
  readonly longPress: ScrollLongPress | undefined;
  touch: Touching | undefined;
}

/**
 * A touch or a pen drags the strip and flings it, a short still touch
 * taps, and one held still selects through `longPress`. Returns the
 * unsubscribe.
 */
export function wireDrag(
  canvas: HTMLCanvasElement,
  controller: ScrollController,
  tap: ScrollTap,
  longPress: ScrollLongPress | undefined,
): () => void {
  const input: TouchInput = { canvas, controller, tap, longPress, touch: undefined };
  const events = [
    [
      'pointerdown',
      (event: PointerEvent) => {
        touchDown(input, event);
      },
    ],
    [
      'pointermove',
      (event: PointerEvent) => {
        touchMove(input, event);
      },
    ],
    [
      'pointerup',
      (event: PointerEvent) => {
        touchUp(input, event);
      },
    ],
    [
      'pointercancel',
      (event: PointerEvent) => {
        touchUp(input, event);
      },
    ],
  ] as const;
  for (const [name, handler] of events) canvas.addEventListener(name, handler);
  return () => {
    clearTimeout(input.touch?.timer);
    for (const [name, handler] of events) canvas.removeEventListener(name, handler);
  };
}

function local(input: TouchInput, event: PointerEvent): { x: number; y: number } {
  const rect = input.canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function touchDown(input: TouchInput, event: PointerEvent): void {
  if (event.pointerType === 'mouse' || !event.isPrimary) return;
  input.canvas.setPointerCapture(event.pointerId);
  input.controller.grab();
  const at = { x: event.clientX, y: event.clientY };
  const held: Touching = {
    ...at,
    at: event.timeStamp,
    last: at,
    samples: [{ dx: 0, timestamp: event.timeStamp }],
    moved: false,
    timer: undefined,
    selecting: null,
  };
  input.touch = held;
  const { longPress } = input;
  if (longPress === undefined) return;
  const point = local(input, event);
  held.timer = setTimeout(() => {
    held.timer = undefined;
    if (input.touch !== held || held.moved) return;
    input.controller.release(0);
    held.selecting = longPress(point.x, point.y);
  }, LONG_PRESS_MS);
}

function touchMove(input: TouchInput, event: PointerEvent): void {
  const { touch, controller } = input;
  if (touch === undefined || !event.isPrimary) return;
  if (touch.selecting) {
    const at = local(input, event);
    touch.selecting.move(at.x, at.y);
    return;
  }
  if (Math.hypot(event.clientX - touch.x, event.clientY - touch.y) >= TAP_SLOP) {
    touch.moved = true;
    clearTimeout(touch.timer);
  }
  const delta =
    controller.axis === 'left' ? event.clientX - touch.last.x : touch.last.y - event.clientY;
  touch.last = { x: event.clientX, y: event.clientY };
  const travelled = (touch.samples.at(-1)?.dx ?? 0) + delta;
  touch.samples = [...touch.samples, { dx: travelled, timestamp: event.timeStamp }].slice(-5);
  controller.follow(delta);
}

function touchUp(input: TouchInput, event: PointerEvent): void {
  const ended = input.touch;
  if (ended === undefined || !event.isPrimary) return;
  input.touch = undefined;
  clearTimeout(ended.timer);
  if (ended.selecting) {
    const at = local(input, event);
    ended.selecting.end(at.x, at.y);
    return;
  }
  const still = !ended.moved && event.timeStamp - ended.at < TAP_MS;
  input.controller.release(still ? 0 : estimateVelocity(ended.samples) * 1000);
  if (still && event.type === 'pointerup') {
    const at = local(input, event);
    input.tap(at.x, at.y);
  }
}
