import type { ReaderLocator } from '@ritojs/core';
import type { ScrollController, ScrollControllerEvents } from '@ritojs/kit';

/** What a scroll view says as it is read: how far through, where, and what is selected. */
export interface ScrollViewReading {
  /** How far through the book the strip is, from 0 to 1. */
  readonly progress: number;
  /** Where the reader reads, as of the strip's last rest. */
  readonly position: ReaderLocator | null;
  /** What is selected, its text and its rects where the view shows them; null for nothing. */
  readonly selection: ScrollControllerEvents['selection'] | null;
}

export const NOTHING_READ: ScrollViewReading = { progress: 0, position: null, selection: null };

/** The view's events into a hook's state. */
export function followScrollView<S extends ScrollViewReading>(
  controller: ScrollController,
  setState: (update: (previous: S) => S) => void,
): () => void {
  const stops = [
    controller.on('scroll', ({ progress }) => {
      setState((previous) =>
        previous.progress === progress ? previous : { ...previous, progress },
      );
    }),
    controller.on('position', ({ locator }) => {
      setState((previous) => ({ ...previous, position: locator }));
    }),
    controller.on('selection', (selection) => {
      setState((previous) => ({ ...previous, selection: selection.range ? selection : null }));
    }),
  ];
  return () => {
    for (const stop of stops) stop();
  };
}
