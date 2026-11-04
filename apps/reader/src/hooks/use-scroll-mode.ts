import { useEffect, useState } from 'react';
import type { TocEntry } from '@ritojs/core';
import type { ReaderController } from '@ritojs/kit';
import { useRitoScrollView } from '@ritojs/react';

interface ScrollModeOptions {
  /** Whether the book is read scrolled now. */
  readonly active: boolean;
  /** How the book is paged again once it is not. */
  readonly paged: 'single' | 'double';
}

const SCROLL_VIEW = { a11y: { enabled: true } } as const;

/**
 * The book the pages show, read scrolled while the mode is on: the same
 * reader, handed from the pages to a scroll view and back. Size, theme and
 * typography reach it through the pages, which lay it out for the view.
 */
export function useScrollMode(
  pages: ReaderController | null,
  { active, paged }: ScrollModeOptions,
) {
  const scroll = useRitoScrollView(pages, { active, paged, scroll: SCROLL_VIEW });
  const { controller } = scroll;
  // The reader the view shows, while it shows one.
  const reader = controller ? (pages?.reader ?? null) : null;
  // The contents entry of the window under the reading line.
  const [activeTocEntry, setActiveTocEntry] = useState<TocEntry | undefined>(undefined);
  useEffect(() => {
    if (!controller || !reader) {
      setActiveTocEntry(undefined);
      return;
    }
    const read = (spreadIndex: number) => {
      const pageIndex = reader.spreads[spreadIndex]?.leftPageIndex;
      setActiveTocEntry(pageIndex === undefined ? undefined : reader.findActiveTocEntry(pageIndex));
    };
    read(controller.currentSpread);
    return controller.on('window', ({ spreadIndex }) => {
      read(spreadIndex);
    });
  }, [controller, reader]);
  return { ...scroll, reader, isLoaded: controller !== null, activeTocEntry };
}
