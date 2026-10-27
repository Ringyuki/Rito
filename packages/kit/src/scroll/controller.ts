import type { Reader, ReaderLocator } from '@ritojs/core';
import { DEFAULT_HIGHLIGHT_COLORS, withHighlightColors } from '../controller/overlay/colors';
import { createDisplaySurface } from '../painter/display-surface';
import { createEmitter } from '../utils/event-emitter';
import { wireScrollA11y } from './a11y';
import { scrollPointAt, scrollTargetAt } from './hit';
import { wireScrollInput } from './input';
import { createScrollMotion } from './motion';
import { createWindowOverlays } from './overlays';
import { defaultScrollPhysics } from './physics';
import { createWindowPool } from './pool';
import { createScrollSelection } from './selection';
import { wireMouseSelection } from './selection-input';
import type { ScrollController, ScrollControllerEvents, ScrollControllerOptions } from './types';
import {
  moveTo,
  ratioOf,
  readingLine,
  relayout,
  schedule,
  selectionRects,
  type ScrollView,
} from './view';

/** A scrolled reader's view on `canvas` (see {@link ScrollController}). */
export function createScrollController(
  reader: Reader,
  canvas: HTMLCanvasElement,
  options: ScrollControllerOptions = {},
): ScrollController {
  const surface = createDisplaySurface(canvas);
  const view: ScrollView = {
    reader,
    surface,
    emitter: createEmitter<ScrollControllerEvents>(),
    pool: createWindowPool(surface.gl, (spreadIndex, target) =>
      reader.renderSpreadTo(spreadIndex, target),
    ),
    overlays: createWindowOverlays(surface.gl),
    motion: createScrollMotion(options.physics ?? defaultScrollPhysics),
    colors: withHighlightColors(DEFAULT_HIGHLIGHT_COLORS, options.colors),
    selection: undefined,
    highlights: [],
    highlighted: 0,
    geometry: undefined,
    current: reader.activeSpreadIndex,
    frame: null,
  };
  if (options.selection !== false) {
    view.selection = createScrollSelection(reader, () => {
      selectionChanged(view);
    });
  }
  const stops: (() => void)[] = [];
  const mirrored = { done: false };
  const controller = controllerOf(
    view,
    () => {
      for (const stop of stops) stop();
    },
    (container) => {
      // The screen readers' mirror goes beside the view once it is shown.
      if (!options.a11y?.enabled || mirrored.done) return;
      mirrored.done = true;
      stops.push(wireScrollA11y(view, options.a11y.container ?? container));
    },
  );
  stops.push(...wireView(view));
  if (options.input !== false) stops.push(...wireInput(view, controller));
  return controller;
}

function wireView(view: ScrollView): (() => void)[] {
  const { reader, surface } = view;
  return [
    reader.onLayoutCommitted(() => {
      relayout(view);
    }),
    reader.onSpreadContentInvalidated((spreadIndex) => {
      view.pool.invalidate(spreadIndex);
      schedule(view);
    }),
    surface.onPixelRatioChange(() => {
      relayout(view);
    }),
    surface.onRestored(() => {
      view.pool.dispose();
      view.overlays.dispose();
      schedule(view);
    }),
  ];
}

/** The built-in input: the strip's, and the mouse's selection when the view selects. */
function wireInput(view: ScrollView, controller: ScrollController): (() => void)[] {
  const canvas = view.surface.canvas;
  const onTap = (x: number, y: number): void => {
    tap(view, controller, x, y);
  };
  const { selection } = view;
  if (selection === undefined) return [wireScrollInput(canvas, controller, onTap)];
  return [
    wireScrollInput(canvas, controller, onTap, { mouseTaps: false }),
    wireMouseSelection(canvas, controller, selection, onTap),
  ];
}

function controllerOf(
  view: ScrollView,
  unsubscribe: () => void,
  mounted: (container: HTMLElement) => void,
): ScrollController {
  const { motion } = view;
  const ratio = (): number => ratioOf(view);
  const controller: ScrollController = {
    mount(container) {
      container.appendChild(view.surface.canvas);
      mounted(container);
      relayout(view);
    },
    get axis() {
      return view.geometry?.axis;
    },
    get offset() {
      return motion.offset / ratio();
    },
    get extent() {
      return (view.geometry?.extent ?? 0) / ratio();
    },
    get currentSpread() {
      return view.current;
    },
    ...movement(view),
    scrollToLocator: (locator) => scrollToLocator(view, controller, locator),
    pointAt: (x, y) =>
      view.geometry === undefined
        ? undefined
        : scrollPointAt(view.reader, view.geometry, motion.offset, view.surface.width, x, y),
    targetAt: (point) => scrollTargetAt(view.reader, point),
    get selection() {
      return view.selection?.snapshot?.range ?? null;
    },
    ...highlighting(view),
    on: (event, listener) => view.emitter.on(event, listener),
    dispose() {
      dispose(view, unsubscribe);
    },
  };
  return controller;
}

/** How the app moves the strip: to an offset or a window, or under a finger. */
function movement(
  view: ScrollView,
): Pick<
  ScrollController,
  'scrollTo' | 'scrollBy' | 'scrollToSpread' | 'grab' | 'follow' | 'release'
> {
  const { motion } = view;
  const ratio = (): number => ratioOf(view);
  return {
    scrollTo(offset, options) {
      moveTo(view, offset * ratio(), options?.animate ?? false);
    },
    scrollBy(delta, options) {
      moveTo(view, motion.offset + delta * ratio(), options?.animate ?? false);
    },
    scrollToSpread(spreadIndex, blockOffset = 0) {
      const window = view.geometry?.windows.find((each) => each.spreadIndex === spreadIndex);
      if (window === undefined) return;
      moveTo(view, window.start + blockOffset * ratio() - readingLine(view), false);
    },
    grab() {
      motion.grab();
    },
    follow(delta) {
      motion.follow(delta * ratio());
      schedule(view);
    },
    release(velocity) {
      motion.release(velocity * ratio(), performance.now());
      schedule(view);
    },
  };
}

/** What is drawn over the text: the selection and the app's highlights. */
function highlighting(
  view: ScrollView,
): Pick<ScrollController, 'selectionRects' | 'clearSelection' | 'setHighlights'> {
  return {
    selectionRects: () => selectionRects(view),
    clearSelection() {
      view.selection?.clear();
    },
    setHighlights(highlights) {
      view.highlights = [...highlights];
      view.highlighted += 1;
      schedule(view);
    },
  };
}

/** What is selected changed: it is drawn again and the app hears it. */
function selectionChanged(view: ScrollView): void {
  schedule(view);
  const snapshot = view.selection?.snapshot ?? null;
  view.emitter.emit('selection', {
    range: snapshot?.range ?? null,
    text: snapshot?.text ?? '',
    selecting: view.selection?.selecting ?? false,
    rects: selectionRects(view),
  });
}

function dispose(view: ScrollView, unsubscribe: () => void): void {
  if (view.frame !== null) cancelAnimationFrame(view.frame);
  unsubscribe();
  view.selection?.dispose();
  view.pool.dispose();
  view.overlays.dispose();
  view.surface.dispose();
  view.emitter.dispose();
  view.surface.canvas.remove();
}

async function scrollToLocator(
  view: ScrollView,
  controller: ScrollController,
  locator: ReaderLocator,
): Promise<boolean> {
  const located = await view.reader.navigateToLocator?.(locator);
  if (located?.status !== 'resolved') return false;
  controller.scrollToSpread(located.spreadIndex, located.blockOffset ?? 0);
  return true;
}

/** A tap of the built-in input: the point and what is under it. */
function tap(view: ScrollView, controller: ScrollController, x: number, y: number): void {
  const point = controller.pointAt(x, y);
  if (point === undefined) return;
  controller.targetAt(point).then(
    (target) => {
      view.emitter.emit('tap', { point, target });
    },
    (error: unknown) => {
      console.error('[rito] the scroll view could not read what a tap is on', error);
    },
  );
}
