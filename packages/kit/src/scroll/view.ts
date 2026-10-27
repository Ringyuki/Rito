import type { Reader } from '@ritojs/core';
import type { HighlightColors } from '../controller/overlay/colors';
import { springSettle } from '../driver/spring';
import type { Rect } from '../interaction/layout-types';
import type { DisplaySurface } from '../painter/display-surface';
import type { DisposableEmitter } from '../utils/event-emitter';
import { compositeWindows } from './composite';
import { createScrollGeometry, type ScrollGeometry, type ScrollWindow } from './geometry';
import { viewRects, windowLayers, type ScrollHighlight } from './highlights';
import type { ScrollMotion } from './motion';
import type { WindowOverlays } from './overlays';
import type { WindowPool } from './pool';
import { readingPosition } from './position';
import type { ScrollSelection } from './selection';
import type { ScrollControllerEvents } from './types';

const GLIDE = { stiffness: 220, damping: 2 * Math.sqrt(220) };

/** A scrolled view's state, which its frames draw from. */
export interface ScrollView {
  readonly reader: Reader;
  readonly surface: DisplaySurface;
  readonly emitter: DisposableEmitter<ScrollControllerEvents>;
  readonly pool: WindowPool;
  readonly overlays: WindowOverlays;
  readonly motion: ScrollMotion;
  readonly colors: HighlightColors;
  selection: ScrollSelection | undefined;
  /** What the app highlights, and a count of its changes. */
  highlights: readonly ScrollHighlight[];
  highlighted: number;
  geometry: ScrollGeometry | undefined;
  /** The window under the reading line, as the reader was last told. */
  current: number;
  frame: number | null;
}

/** Device pixels a CSS pixel of the windows shown: the ratio their geometry was made at. */
export function ratioOf(view: ScrollView): number {
  return view.geometry?.ratio ?? view.reader.dpr;
}

/** The viewport's device pixels along the axis. */
export function along(view: ScrollView): number {
  return view.geometry?.axis === 'left' ? view.surface.width : view.surface.height;
}

/** The reading line in device pixels: the content box's block start, where a locator's line is shown. */
export function readingLine(view: ScrollView): number {
  const margins = view.reader.getLayoutGeometry();
  const margin = view.geometry?.axis === 'left' ? margins.marginRight : margins.marginTop;
  return margin * ratioOf(view);
}

/** Moves the strip to device offset `target`, gliding there when `animate`. */
export function moveTo(view: ScrollView, target: number, animate: boolean): void {
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

export function schedule(view: ScrollView): void {
  view.frame ??= requestAnimationFrame((now) => {
    view.frame = null;
    const moving = view.motion.step(now);
    draw(view);
    if (moving) schedule(view);
    else rest(view);
  });
}

/** The selection and the app's highlights, the selection drawn under them. */
function highlightsOf(view: ScrollView): readonly ScrollHighlight[] {
  const snapshot = view.selection?.snapshot;
  if (!snapshot) return view.highlights;
  return [
    { id: 'selection', rects: snapshot.rects, color: view.colors.selection, zIndex: 0 },
    ...view.highlights,
  ];
}

function pageOf(view: ScrollView, window: ScrollWindow): number | undefined {
  return view.reader.spreads[window.spreadIndex]?.leftPageIndex;
}

/** The selection's rects where the view shows them, in CSS pixels from its top-left corner. */
export function selectionRects(view: ScrollView): Rect[] {
  const { geometry, surface } = view;
  const snapshot = view.selection?.snapshot;
  if (geometry === undefined || !snapshot) return [];
  const origin = view.reader.getLayoutGeometry();
  return viewRects(
    geometry,
    (window) => pageOf(view, window),
    origin,
    view.motion.offset,
    surface.width,
    surface.height,
    snapshot.rects,
  );
}

/** CSS pixels a moved focus is kept in from the view's ends. */
const FOCUS_MARGIN = 40;

/**
 * Scrolls the strip so the selection's focus is on screen, as a browser
 * keeps a moved caret in view: by as little as brings it in from either
 * end, or, when it moved to a window off screen, to its line at the
 * reading line.
 */
export function revealFocus(view: ScrollView): void {
  const { geometry, surface, motion } = view;
  const focus = view.selection?.snapshot?.focusCaret;
  if (geometry === undefined || !focus) return;
  const { ratio } = geometry;
  const origin = view.reader.getLayoutGeometry();
  const caret = { pageIndex: focus.pageIndex, ...focus.geometry };
  const down = geometry.axis === 'down';
  const rect = viewRects(
    geometry,
    (window) => pageOf(view, window),
    origin,
    motion.offset,
    surface.width,
    surface.height,
    [caret],
  )[0];
  if (rect === undefined) {
    const window = geometry.windows.find((each) => pageOf(view, each) === focus.pageIndex);
    if (window === undefined) return;
    const blockOffset = down
      ? origin.marginTop + caret.y
      : window.length / ratio - (origin.marginLeft + caret.x + caret.width);
    moveTo(view, window.start + blockOffset * ratio - readingLine(view), false);
    return;
  }
  const length = along(view) / ratio;
  const viewWidth = surface.width / ratio;
  const [from, to] = down
    ? [rect.y, rect.y + rect.height]
    : [viewWidth - rect.x - rect.width, viewWidth - rect.x];
  if (from < FOCUS_MARGIN) moveTo(view, motion.offset + (from - FOCUS_MARGIN) * ratio, false);
  else if (to > length - FOCUS_MARGIN) {
    moveTo(view, motion.offset + (to - length + FOCUS_MARGIN) * ratio, false);
  }
}

function draw(view: ScrollView): void {
  const { geometry, surface, motion, reader } = view;
  if (geometry === undefined) return;
  surface.clear();
  const version = view.highlighted + (view.selection?.version ?? 0);
  const origin = reader.getLayoutGeometry();
  compositeWindows(
    surface.compositor,
    geometry,
    motion.offset,
    surface.width,
    surface.height,
    (window, rect) => view.pool.picture(window.spreadIndex, rect.width, rect.height),
    (window, rect) => {
      const pageIndex = pageOf(view, window);
      if (pageIndex === undefined) return undefined;
      return view.overlays.texture(
        window.spreadIndex,
        rect.width,
        rect.height,
        geometry.ratio,
        version,
        () => windowLayers(pageIndex, origin, highlightsOf(view)),
      );
    },
  );
  keepNear(view, geometry);
  const viewport = along(view);
  view.emitter.emit('scroll', {
    offset: motion.offset / geometry.ratio,
    extent: geometry.extent / geometry.ratio,
    viewport: viewport / geometry.ratio,
    progress: Math.min(1, Math.max(0, motion.offset / Math.max(1, geometry.extent - viewport))),
  });
  const reading = geometry.windowAt(motion.offset + readingLine(view));
  if (reading !== undefined && reading.spreadIndex !== view.current) {
    view.current = reading.spreadIndex;
    reader.notifyActiveSpread(reading.spreadIndex);
    view.emitter.emit('window', { spreadIndex: reading.spreadIndex });
  }
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
  const kept = new Set(near.map((window) => window.spreadIndex));
  view.pool.keep(kept);
  view.overlays.keep(kept);
}

/**
 * Takes the committed layout: the canvas at the viewport's size and the
 * windows anew, the strip kept on the window under the reading line and
 * as far into it as it was, and the selection found again in it.
 */
export function relayout(view: ScrollView): void {
  const { reader, surface, motion } = view;
  const line = readingLine(view);
  const kept = view.geometry?.windowAt(motion.offset + line);
  // How far into its window the reading line is, in CSS pixels.
  const into = kept === undefined ? 0 : (motion.offset + line - kept.start) / ratioOf(view);
  view.selection?.restore(view.selection.carry());
  const size = reader.getCanvasSize(1);
  surface.setSize(size.width, size.height, reader.dpr);
  const layout = reader.getScrollLayout();
  view.geometry = layout === undefined ? undefined : createScrollGeometry(layout, reader.dpr);
  view.pool.invalidateAll();
  view.highlighted += 1;
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
