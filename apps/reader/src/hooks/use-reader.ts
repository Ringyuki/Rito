import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { preloadReaderRuntime, type ReaderPinnedFontPolicy, type TocEntry } from '@ritojs/core';
import { springPresets, type ReaderControllerEvents, type TransitionEffectName } from '@ritojs/kit';
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
import { fetchShardedDemo } from '@/lib/sharded-demo';
import { useDebugLog } from '@/hooks/use-debug-log';
import { useReaderFonts } from '@/hooks/use-reader-fonts';
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
  const [spreadMode, setSpreadModeState] = useState<'single' | 'double'>('double');
  const typography = useTypography();
  const [pageTurn, setPageTurnState] = useState<TransitionEffectName>('slide');

  // Everything a book opens with — size, spread, theme, typography — goes
  // in here, so it lays out once, already styled.
  const rito = useRitoReader({
    reader: {
      width: containerWidth > 0 ? Math.round(containerWidth) : 0,
      height: containerHeight > 0 ? Math.round(containerHeight) : 0,
      margin: readerViewportMargin(containerWidth),
      spread: spreadMode,
      pinnedFontPolicy,
      ...getThemeOptions(theme),
      ...typographyReaderOptions(typography.typography),
    },
    controller: {
      transition: { ...springPresets.default, effect: pageTurn },
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

  // Page turns by keyboard only while nothing covers the page.
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

  const setSpreadMode = useCallback(
    (mode: 'single' | 'double') => {
      if (mode === spreadMode) return;
      setSpreadModeState(mode);
      controller?.setSpreadMode(mode);
    },
    [controller, spreadMode],
  );

  // How pages turn; a reader on "reduced motion" gets a cross-fade anyway.
  const setPageTurn = useCallback(
    (effect: TransitionEffectName) => {
      setPageTurnState(effect);
      controller?.configureTransition({ effect });
    },
    [controller],
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
      controller?.navigateToTocEntry(entry);
    },
    [controller],
  );

  const spread = rito.spreads[rito.currentSpread];
  const activeTocEntry =
    controller && spread ? controller.reader.findActiveTocEntry(spread.leftPageIndex) : undefined;

  return {
    ...rito,
    selection,
    search,
    annotations,
    position,
    fonts,
    typography,
    spreadMode,
    setSpreadMode,
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

export function readerViewportMargin(containerWidth: number): number {
  return containerWidth < 640 ? 16 : containerWidth < 1024 ? 32 : 50;
}

async function fetchDemoEpubData(): Promise<ArrayBuffer> {
  demoEpubBlobPromise ??= fetch(demoEpubUrl).then(async (resp) => {
    if (!resp.ok) throw new Error(`HTTP ${String(resp.status)}`);
    return resp.blob();
  });
  return (await demoEpubBlobPromise).arrayBuffer();
}
