import { LINE } from './input';
import type { ScrollController } from './types';
import { moveTo, ratioOf, readingLine, readOn, schedule, type ScrollView } from './view';

/** How the app moves the strip: to an offset or a window, or under a finger. */
export function movement(
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
      readOn(view);
      schedule(view);
    },
    release(velocity) {
      motion.release(velocity * ratio(), performance.now());
      schedule(view);
    },
  };
}

/** A page's move: the view's length along the axis less two lines, in CSS pixels. */
export function pageLength(view: ScrollView): number {
  const canvas = view.surface.canvas;
  return (view.geometry?.axis === 'left' ? canvas.clientWidth : canvas.clientHeight) - 2 * LINE;
}
