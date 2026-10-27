import type { ReaderScrollLayout } from '@ritojs/core';

/** One window of a scrolled book on the device grid, along the scroll axis. */
export interface ScrollWindow {
  readonly spreadIndex: number;
  /** Device pixels from the book's block start to the window's. */
  readonly start: number;
  /** Its device pixels along the axis. */
  readonly length: number;
}

/**
 * A scrolled book's windows end to end on the device grid. Within a chapter
 * window `k` starts `D(k) = floor(k·L·ratio + 0.5)` device pixels in, the
 * rule the engine paints its windows by, and the chapter ends at
 * `floor(extent·ratio + 0.5)`; chapters follow one another end to end.
 * Offsets run from the book's block start: down the screen, or leftwards
 * from the right edge for a book whose pages progress right to left.
 */
export interface ScrollGeometry {
  readonly axis: ReaderScrollLayout['axis'];
  readonly ratio: number;
  /** The whole book's device pixels along the axis. */
  readonly extent: number;
  /** Every window, in reading order. */
  readonly windows: readonly ScrollWindow[];
  /** The window holding device offset `offset`; the nearest end one outside the book. */
  windowAt(offset: number): ScrollWindow | undefined;
  /** The windows a viewport `length` device pixels long shows from `offset`. */
  visible(offset: number, length: number): readonly ScrollWindow[];
}

export function createScrollGeometry(layout: ReaderScrollLayout, ratio: number): ScrollGeometry {
  const windows: ScrollWindow[] = [];
  let chapterStart = 0;
  for (const chapter of layout.chapters) {
    const end = Math.floor(chapter.extent * ratio + 0.5);
    const row = (k: number): number =>
      k >= chapter.spreadCount ? end : Math.floor(k * layout.windowLength * ratio + 0.5);
    for (let k = 0; k < chapter.spreadCount; k += 1) {
      windows.push({
        spreadIndex: chapter.firstSpread + k,
        start: chapterStart + row(k),
        length: row(k + 1) - row(k),
      });
    }
    chapterStart += end;
  }
  const windowAt = (offset: number): ScrollWindow | undefined => {
    let low = 0;
    let high = windows.length - 1;
    while (low < high) {
      const middle = (low + high + 1) >> 1;
      if ((windows[middle]?.start ?? 0) <= offset) low = middle;
      else high = middle - 1;
    }
    return windows[low];
  };
  return {
    axis: layout.axis,
    ratio,
    extent: chapterStart,
    windows,
    windowAt,
    visible(offset, length) {
      const first = windowAt(offset);
      if (first === undefined) return [];
      const shown: ScrollWindow[] = [];
      for (let index = windows.indexOf(first); index < windows.length; index += 1) {
        const window = windows[index];
        if (window === undefined || window.start >= offset + length) break;
        if (window.start + window.length > offset) shown.push(window);
      }
      return shown;
    },
  };
}
