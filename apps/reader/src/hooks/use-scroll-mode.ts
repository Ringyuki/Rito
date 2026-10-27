import { useEffect, useRef } from 'react';
import type { ReaderLocator, ReaderPinnedFontPolicy, ReaderPublication } from '@ritojs/core';
import { useRitoScrollReader } from '@ritojs/react';
import { readerViewportMargin } from '@/lib/viewport-margin';
import { copyPublication } from '@/lib/publication-copy';

interface ScrollModeOptions {
  /** Whether the book is read scrolled now. */
  readonly active: boolean;
  /** The book open in the reader, to read scrolled as well. */
  readonly publication: ReaderPublication | null;
  /** Where the reader was when the mode was entered. */
  readonly locator: ReaderLocator | null;
  readonly width: number;
  readonly height: number;
  readonly theme: 'light' | 'dark';
  readonly pinnedFontPolicy: ReaderPinnedFontPolicy;
}

/**
 * The book read scrolled: opened in its own scrolled reader while the mode
 * is on, from where the reader was, and let go when it is turned off.
 */
export function useScrollMode({
  active,
  publication,
  locator,
  width,
  height,
  theme,
  pinnedFontPolicy,
}: ScrollModeOptions) {
  const scroll = useRitoScrollReader({
    reader: {
      width: width > 0 ? Math.round(width) : 0,
      height: height > 0 ? Math.round(height) : 0,
      margin: readerViewportMargin(width),
      pinnedFontPolicy,
      ...themeOptions(theme),
    },
    scroll: { a11y: { enabled: true } },
    initialLocator: locator,
  });
  const { load, unload, controller, reader } = scroll;
  const opened = useRef<ReaderPublication | null>(null);
  useEffect(() => {
    if (!active || publication === null) {
      if (opened.current !== null) {
        opened.current = null;
        void unload();
      }
      return;
    }
    if (opened.current === publication) return;
    opened.current = publication;
    void load(copyPublication(publication));
  }, [active, publication, load, unload]);
  // A link into the book goes where it points.
  useEffect(
    () =>
      controller?.on('tap', ({ target }) => {
        if (target?.targetLocator) void controller.scrollToLocator(target.targetLocator);
      }),
    [controller],
  );
  // The view's size and the theme follow the app's; the reader lays the
  // book out again only for a size it is not laid out at.
  useEffect(() => {
    if (reader && width > 0 && height > 0) {
      reader.updateLayout(
        Math.round(width),
        Math.round(height),
        'scrolled',
        readerViewportMargin(width),
      );
    }
  }, [reader, width, height]);
  useEffect(() => {
    reader?.setTheme(themeOptions(theme));
  }, [reader, theme]);
  return scroll;
}

function themeOptions(theme: 'light' | 'dark') {
  return theme === 'dark'
    ? { backgroundColor: '#1a1a1a', foregroundColor: '#e5e5e5' }
    : { backgroundColor: '#ffffff', foregroundColor: null };
}
