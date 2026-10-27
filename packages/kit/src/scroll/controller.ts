import type { Reader } from '@ritojs/core';
import { createDisplaySurface, type DisplaySurface } from '../painter/display-surface';
import { springSettle } from '../driver/spring';
import { createEmitter, type DisposableEmitter } from '../utils/event-emitter';
import { compositeWindows } from './composite';
import { createScrollGeometry, type ScrollGeometry } from './geometry';
import { wireScrollInput } from './input';
import { createScrollMotion, type ScrollMotion } from './motion';
import { defaultScrollPhysics } from './physics';
import { createWindowPool, type WindowPool } from './pool';
import { readingPosition } from './position';
import type { ScrollController, ScrollControllerEvents, ScrollControllerOptions } from './types';

const GLIDE = { stiffness: 220, damping: 2 * Math.sqrt(220) };

interface ScrollView {
  readonly reader: Reader;
  readonly surface: DisplaySurface;
  readonly emitter: DisposableEmitter<ScrollControllerEvents>;
  readonly pool: WindowPool;
  readonly motion: ScrollMotion;
  geometry: ScrollGeometry | undefined;
  /** The window under the reading line, as the reader was last told. */
  current: number;
  frame: number | null;
}

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
    motion: createScrollMotion(options.physics ?? defaultScrollPhysics),
    geometry: undefined,
    current: reader.activeSpreadIndex,
    frame: null,
  };
  const stops: (() => void)[] = [];
  const controller = controllerOf(view, () => {
    for (const stop of stops) stop();
  });
  stops.push(
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
      schedule(view);
    }),
    ...(options.input === false ? [] : [wireScrollInput(surface.canvas, controller)]),
  );
  return controller;
}

function controllerOf(view: ScrollView, unsubscribe: () => void): ScrollController {
  const { motion } = view;
  const ratio = (): number => ratioOf(view);
  const controller: ScrollController = {
    mount(container) {
      container.appendChild(view.surface.canvas);
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
    async scrollToLocator(locator) {
      const located = await view.reader.navigateToLocator?.(locator);
      if (located?.status !== 'resolved') return false;
      controller.scrollToSpread(located.spreadIndex, located.blockOffset ?? 0);
      return true;
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
    on: (event, listener) => view.emitter.on(event, listener),
    dispose() {
      dispose(view, unsubscribe);
    },
  };
  return controller;
}

function dispose(view: ScrollView, unsubscribe: () => void): void {
  if (view.frame !== null) cancelAnimationFrame(view.frame);
  unsubscribe();
  view.pool.dispose();
  view.surface.dispose();
  view.emitter.dispose();
  view.surface.canvas.remove();
}

/** Moves the strip to device offset `target`, gliding there when `animate`. */
function moveTo(view: ScrollView, target: number, animate: boolean): void {
  if (!animate) {
    view.motion.place(target);
  } else {
    const spring = springSettle(GLIDE, view.motion.offset, 0, target);
    view.motion.glide((seconds) => {
      const at = spring(seconds);
      return { offset: at.done ? target : at.x, velocity: at.velocity, done: at.done };
    }, performance.now());
  }
  schedule(view);
}

/** The viewport's device pixels along the axis. */
function along(view: ScrollView): number {
  return view.geometry?.axis === 'left' ? view.surface.width : view.surface.height;
}

/** Device pixels a CSS pixel of the windows shown: the ratio their geometry was made at. */
function ratioOf(view: ScrollView): number {
  return view.geometry?.ratio ?? view.reader.dpr;
}

/** The reading line in device pixels: the content box's block start, where a locator's line is shown. */
function readingLine(view: ScrollView): number {
  const margins = view.reader.getLayoutGeometry();
  const margin = view.geometry?.axis === 'left' ? margins.marginRight : margins.marginTop;
  return margin * ratioOf(view);
}

function schedule(view: ScrollView): void {
  view.frame ??= requestAnimationFrame((now) => {
    view.frame = null;
    const moving = view.motion.step(now);
    draw(view);
    if (moving) schedule(view);
    else rest(view);
  });
}

/** The strip came to rest: say where, then where the reader reads. */
function rest(view: ScrollView): void {
  const { geometry, motion } = view;
  view.emitter.emit('rest', { offset: motion.offset / ratioOf(view) });
  if (geometry === undefined) return;
  const offset = motion.offset;
  readingPosition(view.reader, geometry, offset, readingLine(view)).then(
    (locator) => {
      // A position the strip has since moved away from is not where it reads.
      if (locator !== undefined && view.geometry === geometry && view.motion.offset === offset) {
        view.emitter.emit('position', { locator });
      }
    },
    (error: unknown) => {
      console.error('[rito] the scroll view could not read its reading position', error);
    },
  );
}

function draw(view: ScrollView): void {
  const { geometry, surface, motion, reader } = view;
  if (geometry === undefined) return;
  surface.clear();
  compositeWindows(
    surface.compositor,
    geometry,
    motion.offset,
    surface.width,
    surface.height,
    (window, rect) => view.pool.picture(window.spreadIndex, rect.width, rect.height),
  );
  keepNear(view, geometry);
  view.emitter.emit('scroll', {
    offset: motion.offset / geometry.ratio,
    extent: geometry.extent / geometry.ratio,
  });
  const reading = geometry.windowAt(motion.offset + readingLine(view));
  if (reading !== undefined && reading.spreadIndex !== view.current) {
    view.current = reading.spreadIndex;
    reader.notifyActiveSpread(reading.spreadIndex);
    view.emitter.emit('window', { spreadIndex: reading.spreadIndex });
  }
}

/**
 * The windows shown and one either side keep their pictures; the ones
 * beside are painted ahead, which has the reader load them.
 */
function keepNear(view: ScrollView, geometry: ScrollGeometry): void {
  const shown = geometry.visible(Math.round(view.motion.offset), along(view));
  const first = shown[0];
  const last = shown.at(-1);
  if (first === undefined || last === undefined) return;
  const from = geometry.windows.indexOf(first);
  const to = geometry.windows.indexOf(last);
  const near = geometry.windows.slice(Math.max(0, from - 1), to + 2);
  const { width, height } = view.surface;
  for (const window of near) {
    if (shown.includes(window)) continue;
    const [w, h] = geometry.axis === 'down' ? [width, window.length] : [window.length, height];
    view.pool.picture(window.spreadIndex, w, h);
  }
  view.pool.keep(new Set(near.map((window) => window.spreadIndex)));
}

/**
 * Takes the committed layout: the canvas at the viewport's size and the
 * windows anew, the strip kept on the window under the reading line and
 * as far into it as it was.
 */
function relayout(view: ScrollView): void {
  const { reader, surface, motion } = view;
  const line = readingLine(view);
  const kept = view.geometry?.windowAt(motion.offset + line);
  // How far into its window the reading line is, in CSS pixels.
  const into = kept === undefined ? 0 : (motion.offset + line - kept.start) / ratioOf(view);
  const size = reader.getCanvasSize(1);
  surface.setSize(size.width, size.height, reader.dpr);
  const layout = reader.getScrollLayout();
  view.geometry = layout === undefined ? undefined : createScrollGeometry(layout, reader.dpr);
  view.pool.invalidateAll();
  if (view.geometry === undefined) return;
  motion.bound(view.geometry.extent - along(view), along(view));
  const spreadIndex = kept?.spreadIndex ?? view.current;
  const window = view.geometry.windows.find((each) => each.spreadIndex === spreadIndex);
  if (window !== undefined) {
    const depth = Math.min(into * view.geometry.ratio, window.length - 1);
    motion.place(window.start + depth - readingLine(view));
  }
  schedule(view);
}
