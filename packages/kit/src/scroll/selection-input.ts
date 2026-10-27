import {
  isAppleKeyboardPlatform,
  keyboardSelectionMovement,
} from '../controller/wiring/keyboard-selection-map';
import type { NativeSelectionGranularity } from '../interaction/selection/native-types';
import type { ScrollTap } from './input';
import type { ScrollSelection } from './selection';
import type { ScrollController } from './types';

/** CSS pixels a pressed mouse moves before it selects rather than clicks. */
const DRAG_SLOP = 4;
/** CSS pixels from a view's ends where a drag scrolls the strip on. */
const EDGE = 40;
/** CSS pixels a frame the strip scrolls with the pointer at the very end. */
const EDGE_SPEED = 24;

interface Press {
  readonly x: number;
  readonly y: number;
  readonly granularity: NativeSelectionGranularity;
  /** Whether it selects: it moved past the slop or picked a word or paragraph. */
  selecting: boolean;
  /** The pointer's last view point. */
  at: ViewPoint;
  /** Whether the button is still held: a frame asked for before it let go does nothing. */
  held: boolean;
  frame: number | null;
}

type ViewPoint = { readonly x: number; readonly y: number };

/**
 * The mouse selects text: a drag selects from where it was pressed, a
 * double press a word and a triple press a paragraph, and a drag held
 * near either end of the view scrolls the strip on under it. A press that
 * does not move is a click: it clears what was selected and taps. Returns
 * the unsubscribe.
 */
export function wireMouseSelection(
  canvas: HTMLCanvasElement,
  controller: ScrollController,
  selection: ScrollSelection,
  tap: ScrollTap,
): () => void {
  let press: Press | undefined;
  const onDown = (event: PointerEvent): void => {
    if (event.pointerType !== 'mouse' || event.button !== 0) return;
    canvas.setPointerCapture(event.pointerId);
    press = pressed(viewPoint(canvas, event), granularityOf(event.detail));
    if (press.selecting) select(controller, selection, press, press.at, 'begin');
  };
  const onMove = (event: PointerEvent): void => {
    if (press === undefined || event.pointerType !== 'mouse') return;
    drag(canvas, controller, selection, press, viewPoint(canvas, event));
  };
  const onUp = (event: PointerEvent): void => {
    if (press === undefined || event.pointerType !== 'mouse') return;
    const released = press;
    press = undefined;
    const at = viewPoint(canvas, event);
    released.held = false;
    if (released.frame !== null) cancelAnimationFrame(released.frame);
    if (released.selecting) select(controller, selection, released, at, 'end');
    else if (event.type === 'pointerup') {
      selection.clear();
      tap(at.x, at.y);
    }
  };
  const events = [
    ['pointerdown', onDown],
    ['pointermove', onMove],
    ['pointerup', onUp],
    ['pointercancel', onUp],
  ] as const;
  for (const [name, handler] of events) canvas.addEventListener(name, handler);
  return () => {
    if (press?.frame != null) cancelAnimationFrame(press.frame);
    for (const [name, handler] of events) canvas.removeEventListener(name, handler);
  };
}

function viewPoint(canvas: HTMLCanvasElement, event: PointerEvent): ViewPoint {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

function pressed(at: ViewPoint, granularity: NativeSelectionGranularity): Press {
  return {
    ...at,
    granularity,
    selecting: granularity !== 'character',
    at,
    held: true,
    frame: null,
  };
}

/** Selects through the page point under view point `at`, if any. */
function select(
  controller: ScrollController,
  selection: ScrollSelection,
  press: Press,
  at: ViewPoint,
  step: 'begin' | 'move' | 'end',
): void {
  const point = controller.pointAt(at.x, at.y);
  if (point === undefined) return;
  if (step === 'begin') selection.begin(point, press.granularity);
  else if (step === 'move') selection.move(point);
  else selection.end(point);
}

/** The pressed mouse moved to `at`: past the slop it selects, and near an end it scrolls. */
function drag(
  canvas: HTMLCanvasElement,
  controller: ScrollController,
  selection: ScrollSelection,
  press: Press,
  at: ViewPoint,
): void {
  press.at = at;
  if (!press.selecting) {
    if (Math.hypot(at.x - press.x, at.y - press.y) < DRAG_SLOP) return;
    press.selecting = true;
    select(controller, selection, press, { x: press.x, y: press.y }, 'begin');
  }
  select(controller, selection, press, at, 'move');
  scrollAtEdge(canvas, controller, press, (point) => {
    select(controller, selection, press, point, 'move');
  });
}

function granularityOf(clicks: number): NativeSelectionGranularity {
  if (clicks === 2) return 'word';
  if (clicks >= 3) return 'paragraph';
  return 'character';
}

/**
 * While the pointer is held near an end of the view along the axis, the
 * strip scrolls on each frame, faster nearer the end, and the selection
 * follows to what comes under the pointer.
 */
function scrollAtEdge(
  canvas: HTMLCanvasElement,
  controller: ScrollController,
  press: Press,
  follow: (at: ViewPoint) => void,
): void {
  if (press.frame !== null) return;
  const step = (): void => {
    press.frame = null;
    if (!press.held) return;
    const speed = edgeSpeed(canvas, controller, press.at);
    if (speed === 0) return;
    controller.scrollBy(speed);
    follow(press.at);
    press.frame = requestAnimationFrame(step);
  };
  if (edgeSpeed(canvas, controller, press.at) !== 0) press.frame = requestAnimationFrame(step);
}

/** How far a frame scrolls with the pointer at `at`: forward near the far end, back near the near one. */
export function edgeSpeed(
  canvas: Pick<HTMLCanvasElement, 'clientWidth' | 'clientHeight'>,
  controller: Pick<ScrollController, 'axis'>,
  at: ViewPoint,
): number {
  // Along the axis from the view's block start: its top, or its right edge.
  const left = controller.axis === 'left';
  const length = left ? canvas.clientWidth : canvas.clientHeight;
  const along = left ? canvas.clientWidth - at.x : at.y;
  if (along < EDGE) return -EDGE_SPEED * (1 - Math.max(0, along) / EDGE);
  if (along > length - EDGE) return EDGE_SPEED * (1 - Math.max(0, length - along) / EDGE);
  return 0;
}

/**
 * A Shift chord moves what is selected's focus, the platform's way and
 * with the arrow keys read by the focus's writing mode, ahead of the keys
 * that scroll; `moved` hears each movement that landed. Returns the
 * unsubscribe.
 */
export function wireKeySelection(selection: ScrollSelection, moved: () => void): () => void {
  const apple = isAppleKeyboardPlatform(navigator);
  const onKey = (event: KeyboardEvent): void => {
    if (selection.snapshot === null || selection.selecting) return;
    const movement = keyboardSelectionMovement(event, apple, selection.focusWritingMode);
    if (movement === null) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    selection.extend(movement).then(
      (landed) => {
        if (landed) moved();
      },
      (error: unknown) => {
        console.error('[rito] the scroll view could not move its selection', error);
      },
    );
  };
  window.addEventListener('keydown', onKey, { capture: true });
  return () => {
    window.removeEventListener('keydown', onKey, { capture: true });
  };
}
