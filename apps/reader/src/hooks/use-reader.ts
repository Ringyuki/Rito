import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { preloadReaderRuntime, type ReaderPinnedFontPolicy, type TocEntry } from '@ritojs/core';
import { createPaperTurn, springPresets, type ReaderControllerEvents } from '@ritojs/kit';
import type { PageTurn } from '@/components/settings-panel';
import type { AnnotationKind } from '@/components/annotation-toolbar';
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
import { readerViewportMargin } from '@/lib/viewport-margin';
import { fetchShardedDemo } from '@/lib/sharded-demo';
import { useDebugLog } from '@/hooks/use-debug-log';
import { useReaderFonts } from '@/hooks/use-reader-fonts';
import { useScrollMode } from '@/hooks/use-scroll-mode';
import {
  annotationOfHighlight,
  useScrollAnnotationPointer,
  useScrollAnnotations,
} from '@/hooks/use-scroll-annotations';
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

  const scroll = useScrollMode(controller, {
    active: spreadMode === 'scrolled',
    paged: pagedMode,
  });
  useEffect(() => {
    // The scroll view too, while the book is read scrolled.
    (window as unknown as { __ritoScroll?: unknown }).__ritoScroll = scroll.controller;
  }, [scroll.controller]);

  // A tap on a note reference read scrolled opens the note as on a page,
  // an image opens in the lightbox (its object URL is the app's to let go),
  // and a link into the book goes where it points.
  const scrollImageUrl = useRef<string | null>(null);
  const releaseScrollImage = useCallback(() => {
    if (scrollImageUrl.current) URL.revokeObjectURL(scrollImageUrl.current);
    scrollImageUrl.current = null;
  }, []);
  // An annotation tapped opens to edit (useScrollAnnotationPointer), before
  // any link under it, as on a page.
  const annotationRecords = useRef(annotations.annotations);
  annotationRecords.current = annotations.annotations;
  const scrollAnnotationPointer = useScrollAnnotationPointer(
    scroll.controller,
    annotations.annotations,
  );
  useEffect(() => {
    const view = scroll.controller;
    const interactions = scroll.reader?.interactions;
    if (!view) return;
    return view.on('tap', ({ point, target, highlight }) => {
      if (highlight && annotationOfHighlight(highlight.id, annotationRecords.current)) return;
      if (!target) return;
      const follow = () => {
        if (target.targetLocator) void view.scrollToLocator(target.targetLocator);
      };
      if (target.kind === 'image' && target.imageSrc && scroll.reader) {
        const src = target.imageSrc;
        const bounds = view.viewRects([{ pageIndex: point.pageIndex, ...target.bounds }])[0];
        const canvas = view.canvas.getBoundingClientRect();
        void Promise.resolve(scroll.reader.getImageBlobUrl(src)).then((blobUrl) => {
          if (!blobUrl || !bounds) return;
          releaseScrollImage();
          scrollImageUrl.current = blobUrl;
          setLightboxImage({
            src,
            alt: target.imageAlt ?? '',
            blobUrl,
            screenBounds: { ...bounds, x: canvas.left + bounds.x, y: canvas.top + bounds.y },
          });
          setLightboxActive(true);
        });
        return;
      }
      const key = target.footnoteKey;
      if (target.kind !== 'footnote' || !key || !interactions) {
        follow();
        return;
      }
      void interactions.getFootnote(key).then((content) => {
        if (content) setFootnote({ id: key, href: target.href ?? '', content });
        else follow();
      }, follow);
    });
  }, [releaseScrollImage, scroll.controller, scroll.reader]);
  const scrollSearch = useScrollSearch(scroll);
  // The book's annotations and the search result the reader is on, drawn
  // over the text read scrolled.
  const scrollAnnotations = useScrollAnnotations(
    scroll.reader,
    annotations.annotations,
    scroll.position,
  );
  // The selection read scrolled, kept as an annotation among the book's,
  // which both modes show, as the paged reader's toolbar keeps it.
  const annotateScrollSelection = useCallback(
    async (kind: AnnotationKind, color: string, note?: string) => {
      const locator = scroll.selection?.range?.sourceLocator;
      const interactions = scroll.reader?.interactions;
      if (!locator?.sourceRange || !interactions?.createAnnotationTarget) return;
      scroll.controller?.clearSelection();
      const target = await interactions.createAnnotationTarget({
        href: locator.href,
        sourceRange: locator.sourceRange,
      });
      if (!target) {
        toast.error('Could not add the annotation');
        return;
      }
      annotations.insert({
        id: crypto.randomUUID(),
        kind,
        color,
        ...(note ? { note } : {}),
        target,
        createdAt: Date.now(),
      });
    },
    [annotations, scroll.controller, scroll.reader, scroll.selection],
  );
  const searchHighlight = scrollSearch.highlight;
  useEffect(() => {
    scroll.controller?.setHighlights(
      searchHighlight ? [...scrollAnnotations, searchHighlight] : scrollAnnotations,
    );
  }, [scroll.controller, scrollAnnotations, searchHighlight]);
  // Where the book is read scrolled is saved as the pages' position is, so
  // the book opens there next time; each rest saves it once.
  const scrollProgress = useRef(0);
  scrollProgress.current = scroll.progress;
  useEffect(() => {
    const read = scroll.position;
    if (spreadMode !== 'scrolled' || !read) return;
    void storage.positionStorage.save(
      JSON.stringify({
        sourceLocator: read,
        projection: { spreadIndex: 0, pageIndex: 0 },
        progress: scrollProgress.current,
        timestamp: Date.now(),
      }),
    );
  }, [scroll.position, spreadMode]);
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

  // Page turns by keyboard only while nothing covers the page (and the
  // pages take no keys while a scroll view has the book).
  const overlayOpen = lightboxActive || pendingLink !== null || footnote !== null || searchOpen;
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
        await rito.load(publication);
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

  // Scrolled reading hands the pages' reader to a scroll view from where
  // the pages were (useScrollMode); paging again lays it out as chosen,
  // from where the view was read, and gives it back to the pages.
  const setSpreadMode = useCallback(
    (mode: 'single' | 'double' | 'scrolled') => {
      if (mode === spreadMode) return;
      setSpreadModeState(mode);
      if (mode === 'scrolled') return;
      setPagedMode(mode);
      if (spreadMode !== 'scrolled') controller?.setSpreadMode(mode);
    },
    [controller, spreadMode],
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
    spreadMode === 'scrolled'
      ? scroll.activeTocEntry
      : controller && spread
        ? controller.reader.findActiveTocEntry(spread.leftPageIndex)
        : undefined;

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
    annotateScrollSelection,
    scrollAnnotationPointer,
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
      releaseScrollImage();
    }, [releaseScrollImage]),
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
