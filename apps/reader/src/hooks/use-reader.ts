import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  preloadReaderRuntime,
  type ReaderLocator,
  type ReaderPinnedFontPolicy,
  type ReaderPublication,
  type TocEntry,
} from '@ritojs/core';
import { createPaperTurn, springPresets, type ReaderControllerEvents } from '@ritojs/kit';
import type { PageTurn } from '@/components/settings-panel';
import {
  useAnnotations,
  useControllerEvent,
  useReaderTransition,
  useReadingPosition,
  useRitoReader,
  useSearch,
  useSelection,
} from '@ritojs/react';
import { bookKey, createBookStorage } from '@/lib/book-storage';
import { noteDebug } from '@/lib/debug-log';
import { copyPublication } from '@/lib/publication-copy';
import { readerViewportMargin } from '@/lib/viewport-margin';
import { fetchShardedDemo } from '@/lib/sharded-demo';
import { useDebugLog } from '@/hooks/use-debug-log';
import { useReaderFonts } from '@/hooks/use-reader-fonts';
import { useScrollMode } from '@/hooks/use-scroll-mode';
import { useScrollSearch } from '@/hooks/use-scroll-search';
import { typographyReaderOptions, useApplyTypography, useTypography } from '@/hooks/use-typography';
import demoEpubUrl from '@/assets/demo.epub?url';

const storage = createBookStorage();
let demoEpubBlobPromise: Promise<Blob> | undefined;

void preloadReaderRuntime().catch(() => undefined);

function getThemeOptions(theme: 'light' | 'dark') {
  if (theme === 'dark') return { backgroundColor: '#1a1a1a', foregroundColor: '#e5e5e5' };
  return { backgroundColor: '#ffffff', foregroundColor: null };
}

export function useReader(
  theme: 'light' | 'dark',
  containerWidth: number,
  containerHeight: number,
  pinnedFontPolicy: ReaderPinnedFontPolicy,
) {
  const [spreadMode, setSpreadModeState] = useState<'single' | 'double' | 'scrolled'>('double');
  // How the book is paged when it is not read scrolled.
  const [pagedMode, setPagedMode] = useState<'single' | 'double'>('double');
  const [publication, setPublication] = useState<ReaderPublication | null>(null);
  const [scrollFrom, setScrollFrom] = useState<ReaderLocator | null>(null);
  const typography = useTypography();
  const [pageTurn, setPageTurnState] = useState<PageTurn>('slide');
  // The paper turn simulates one sheet: one of it for this reader.
  const paperTurn = useMemo(() => createPaperTurn(), []);
  const effectOf = useCallback(
    (turn: PageTurn) => (turn === 'paper' ? paperTurn : turn),
    [paperTurn],
  );

  // Everything a book opens with — size, spread, theme, typography — goes
  // in here, so it lays out once, already styled.
  const rito = useRitoReader({
    reader: {
      width: containerWidth > 0 ? Math.round(containerWidth) : 0,
      height: containerHeight > 0 ? Math.round(containerHeight) : 0,
      margin: readerViewportMargin(containerWidth),
      spread: pagedMode,
      pinnedFontPolicy,
      ...getThemeOptions(theme),
      ...typographyReaderOptions(typography.typography),
    },
    controller: {
      transition: { ...springPresets.default, effect: effectOf(pageTurn) },
      positionStorage: storage.positionStorage,
      annotationStorage: storage.annotationStorage,
      a11y: { enabled: true },
    },
  });
  const controller = rito.controller;
  useApplyTypography(controller, typography);
  useDebugLog(controller, {
    width: Math.round(containerWidth),
    height: Math.round(containerHeight),
    spreadMode,
    theme,
    pageTurn,
    typography: typography.typography,
  });

  useEffect(() => {
    // Headless verification drives and inspects the controller directly and
    // opens any publication, a sharded one included.
    const host = window as unknown as { __ritoController?: unknown; __ritoLoad?: unknown };
    host.__ritoController = controller;
    host.__ritoLoad = rito.load;
  }, [controller, rito.load]);

  const selection = useSelection(controller);
  const search = useSearch(controller);
  const annotations = useAnnotations(controller);
  const position = useReadingPosition(controller);
  const fonts = useReaderFonts(controller, rito.isLoaded);
  const transition = useReaderTransition(controller);
  const [renderScale, setRenderScaleState] = useState(1);

  const [pendingLink, setPendingLink] = useState<ReaderControllerEvents['linkClick'] | null>(null);
  const [footnote, setFootnote] = useState<ReaderControllerEvents['footnoteClick'] | null>(null);
  const [lightboxImage, setLightboxImage] = useState<ReaderControllerEvents['imageClick'] | null>(
    null,
  );
  // The lightbox stays "open" until its exit animation completes.
  const [lightboxActive, setLightboxActive] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useControllerEvent(controller, 'linkClick', setPendingLink);
  useControllerEvent(controller, 'footnoteClick', setFootnote);
  useControllerEvent(controller, 'imageClick', (image) => {
    setLightboxImage(image);
    setLightboxActive(true);
  });
  useControllerEvent(controller, 'searchOpen', () => {
    setSearchOpen(true);
  });
  // The controller's errors are non-fatal: the book stays open.
  useControllerEvent(controller, 'error', ({ message, source }) => {
    if (source !== 'font-family') toast.error(message, { description: source });
  });

  useEffect(() => {
    setRenderScaleState(1);
  }, [controller]);

  const scroll = useScrollMode({
    active: spreadMode === 'scrolled',
    publication,
    locator: scrollFrom,
    width: containerWidth,
    height: containerHeight,
    theme,
    pinnedFontPolicy,
  });

  const scrollSearch = useScrollSearch(scroll);
  // ⌘F / Ctrl+F searches the book read scrolled, as the controller's
  // `searchOpen` does for pages.
  useEffect(() => {
    if (spreadMode !== 'scrolled') return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
    };
  }, [spreadMode]);

  // Page turns by keyboard only while nothing covers the page and the
  // book is not read scrolled.
  const overlayOpen =
    lightboxActive ||
    pendingLink !== null ||
    footnote !== null ||
    searchOpen ||
    spreadMode === 'scrolled';
  useEffect(() => {
    controller?.keyboard.setEnabled(!overlayOpen);
  }, [overlayOpen, controller]);

  useEffect(() => {
    if (!controller) return;
    controller.setTheme(getThemeOptions(theme));
  }, [theme, controller]);

  const open = useCallback(
    async (key: string, publication: Parameters<typeof rito.load>[0]) => {
      storage.setBook(key);
      typography.markOpening();
      noteDebug('open-book', {
        key,
        bytes: publication instanceof ArrayBuffer ? publication.byteLength : 'sharded',
      });
      try {
        // A copy is kept to read scrolled as well (see copyPublication).
        const bytes = await publication;
        setPublication(copyPublication(bytes));
        await rito.load(bytes);
        noteDebug('book-opened', key);
      } catch (error) {
        noteDebug('book-failed', error);
        throw error;
      }
    },
    [rito, typography],
  );

  const loadFromArrayBuffer = useCallback(
    async (data: ArrayBuffer) => {
      await open(await bookKey(data), data);
    },
    [open],
  );

  const loadDemo = useCallback(async () => {
    await open('demo', await fetchDemoEpubData());
  }, [open]);

  const loadShardedDemo = useCallback(async () => {
    try {
      const { bookId, publication } = await fetchShardedDemo();
      await open(`shards:${bookId}`, publication);
    } catch (error) {
      toast.error('Could not open the sharded demo', {
        description: error instanceof Error ? error.message : String(error),
      });
    }
  }, [open]);

  // Scrolled reading opens the book in a scroll view from where the pages
  // were; paging again goes back to where the scroll view was read.
  const setSpreadMode = useCallback(
    (mode: 'single' | 'double' | 'scrolled') => {
      if (mode === spreadMode) return;
      setSpreadModeState(mode);
      if (mode === 'scrolled') {
        setScrollFrom(controller?.position?.sourceLocator ?? null);
        return;
      }
      setPagedMode(mode);
      if (mode !== pagedMode) controller?.setSpreadMode(mode);
      const read = scroll.position;
      if (spreadMode === 'scrolled' && read && controller) {
        void controller.goToPosition({
          sourceLocator: read,
          projection: { spreadIndex: 0, pageIndex: 0 },
          progress: scroll.progress,
          timestamp: Date.now(),
        });
      }
    },
    [controller, pagedMode, scroll.position, scroll.progress, spreadMode],
  );

  // How pages turn; a reader on "reduced motion" gets a cross-fade anyway.
  const setPageTurn = useCallback(
    (turn: PageTurn) => {
      setPageTurnState(turn);
      controller?.configureTransition({ effect: effectOf(turn) });
    },
    [controller, effectOf],
  );

  const setRenderScale = useCallback(
    (scale: number) => {
      setRenderScaleState(scale);
      controller?.setRenderScale(scale);
    },
    [controller],
  );

  const navigateToTocEntry = useCallback(
    (entry: TocEntry) => {
      if (spreadMode === 'scrolled') {
        const [href = entry.href, anchorId] = entry.href.split('#');
        void scroll.controller?.scrollToLocator(anchorId ? { href, anchorId } : { href });
        return;
      }
      controller?.navigateToTocEntry(entry);
    },
    [controller, scroll.controller, spreadMode],
  );

  const spread = rito.spreads[rito.currentSpread];
  const activeTocEntry =
    controller && spread ? controller.reader.findActiveTocEntry(spread.leftPageIndex) : undefined;

  return {
    ...rito,
    selection,
    search: spreadMode === 'scrolled' ? scrollSearch : search,
    annotations,
    position,
    fonts,
    typography,
    spreadMode,
    setSpreadMode,
    scroll,
    renderScale,
    setRenderScale,
    isTransitioning: transition.isTransitioning,
    pageTurn,
    setPageTurn,
    bookTitle: rito.metadata?.title ?? '',
    activeTocEntry,
    loadFromArrayBuffer,
    loadDemo,
    loadShardedDemo,
    navigateToTocEntry,
    pendingLink,
    dismissLink: useCallback(() => {
      setPendingLink(null);
    }, []),
    footnote,
    dismissFootnote: useCallback(() => {
      setFootnote(null);
    }, []),
    lightboxImage,
    dismissLightbox: useCallback(() => {
      setLightboxImage(null);
    }, []),
    onLightboxExitComplete: useCallback(() => {
      setLightboxActive(false);
    }, []),
    searchOpen,
    setSearchOpen,
  };
}

export { readerViewportMargin } from '@/lib/viewport-margin';

async function fetchDemoEpubData(): Promise<ArrayBuffer> {
  demoEpubBlobPromise ??= fetch(demoEpubUrl).then(async (resp) => {
    if (!resp.ok) throw new Error(`HTTP ${String(resp.status)}`);
    return resp.blob();
  });
  return (await demoEpubBlobPromise).arrayBuffer();
}
