import { useCallback, useEffect, useState } from 'react';
import { preloadReaderRuntime, type ReaderPinnedFontPolicy, type TocEntry } from '@ritojs/core';
import type { ReaderControllerEvents } from '@ritojs/kit';
import {
  useRitoReader,
  useSelection,
  useSearch,
  useAnnotations,
  useControllerEvent,
} from '@ritojs/react';
import {
  createLocalStoragePositionAdapter,
  createLocalStorageAnnotationAdapter,
} from '@ritojs/kit';
import { DEFAULT_SETTINGS, type ReaderLineBreaking } from '@/components/settings-panel';
import demoEpubUrl from '@/assets/demo.epub?url';

const ZOOM_SCALE_STEP = 0.1;
const ZOOM_SCALE_MIN = 0.5;
const ZOOM_SCALE_MAX = 2.0;

const positionStorage = createLocalStoragePositionAdapter('rito-position');
const annotationStorage = createLocalStorageAnnotationAdapter('rito-annotations');
let demoEpubBlobPromise: Promise<Blob> | undefined;

void preloadReaderRuntime().catch(() => undefined);

function getThemeOptions(theme: 'light' | 'dark') {
  if (theme === 'dark') return { backgroundColor: '#1a1a1a', foregroundColor: '#e5e5e5' };
  return { backgroundColor: '#ffffff', foregroundColor: null };
}

/**
 * The fragment engine paginates every representable book (unsupported
 * constructs degrade with a recorded approximation instead of blocking).
 * `?fragmentPagination=0` is the kill switch back to the retained
 * engine while it still exists.
 */
const FRAGMENT_PAGINATION_ENABLED =
  typeof window === 'undefined' ||
  new URLSearchParams(window.location.search).get('fragmentPagination') !== '0';

export function useReader(
  theme: 'light' | 'dark',
  containerWidth: number,
  containerHeight: number,
  pinnedFontPolicy: ReaderPinnedFontPolicy,
) {
  const [spreadMode, setSpreadModeState] = useState<'single' | 'double'>(
    DEFAULT_SETTINGS.spreadMode,
  );
  const [zoomScale, setZoomScale] = useState(DEFAULT_SETTINGS.zoomScale);
  const [lineHeight, setLineHeightState] = useState(DEFAULT_SETTINGS.lineHeight);
  const [lineHeightActive, setLineHeightActive] = useState(DEFAULT_SETTINGS.lineHeightActive);
  const [lineHeightForce, setLineHeightForceState] = useState(DEFAULT_SETTINGS.lineHeightForce);
  const [fontFamily, setFontFamilyState] = useState(DEFAULT_SETTINGS.fontFamily);
  const [lineBreaking, setLineBreakingState] = useState(DEFAULT_SETTINGS.lineBreaking);

  const vpWidth = containerWidth > 0 ? Math.round(containerWidth / zoomScale) : 0;
  const vpHeight = containerHeight > 0 ? Math.round(containerHeight / zoomScale) : 0;
  const margin = readerViewportMargin(containerWidth);

  const rito = useRitoReader({
    reader: {
      width: vpWidth,
      height: vpHeight,
      margin,
      spread: spreadMode,
      lineBreaking,
      pinnedFontPolicy,
      experimentalFragmentPagination: FRAGMENT_PAGINATION_ENABLED,
      ...getThemeOptions(theme),
    },
    controller: {
      transition: { stiffness: 180, damping: 22 },
      renderScale: zoomScale,
      positionStorage,
      annotationStorage,
      a11y: {
        enabled: true,
      },
    },
  });

  if (FRAGMENT_PAGINATION_ENABLED && typeof window !== 'undefined') {
    // Debug probe for the fragment-pagination cutover: lets headless
    // verification drive and inspect the controller directly.
    (window as unknown as { __ritoController?: unknown }).__ritoController = rito.controller;
  }
  const selection = useSelection(rito.controller);
  const search = useSearch(rito.controller);
  const annotations = useAnnotations(rito.controller);
  const [isTransitioning, setIsTransitioning] = useState(false);

  // Content interaction events
  const [pendingLink, setPendingLink] = useState<ReaderControllerEvents['linkClick'] | null>(null);
  const [footnote, setFootnote] = useState<ReaderControllerEvents['footnoteClick'] | null>(null);
  const [lightboxImage, setLightboxImage] = useState<ReaderControllerEvents['imageClick'] | null>(
    null,
  );
  const [lightboxActive, setLightboxActive] = useState(false);

  useControllerEvent(rito.controller, 'linkClick', setPendingLink);
  useControllerEvent(rito.controller, 'footnoteClick', setFootnote);
  useControllerEvent(rito.controller, 'imageClick', (img) => {
    setLightboxImage(img);
    setLightboxActive(true);
  });
  useControllerEvent(rito.controller, 'searchOpen', () => {
    setSearchOpen(true);
  });
  useControllerEvent(rito.controller, 'transitionStart', () => {
    setIsTransitioning(true);
  });
  useControllerEvent(rito.controller, 'transitionEnd', () => {
    setIsTransitioning(false);
  });

  useEffect(() => {
    setIsTransitioning(false);
  }, [rito.controller]);

  // Disable keyboard navigation while lightbox is open (including exit animation)
  useEffect(() => {
    rito.controller?.keyboard.setEnabled(!lightboxActive);
  }, [lightboxActive, rito.controller]);

  const [searchOpen, setSearchOpen] = useState(false);

  // Sync theme
  useEffect(() => {
    if (!rito.controller) return;
    rito.setTheme(getThemeOptions(theme));
  }, [theme, rito.controller]);

  // Sync typography when values change after load.
  // Skipped until the reader is loaded: setTypography is a no-op without a document.
  // `null` clears the override so the book's natural value is restored.
  useEffect(() => {
    if (!rito.controller || !rito.isLoaded) return;
    rito.setTypography({
      lineHeight: lineHeightActive ? lineHeight : null,
      lineHeightForce: lineHeightActive && lineHeightForce,
      fontFamily,
    });
  }, [lineHeight, lineHeightActive, lineHeightForce, fontFamily, rito.controller, rito.isLoaded]);

  // Actions
  const loadFromArrayBuffer = useCallback(
    async (data: ArrayBuffer) => {
      await rito.load(data);
    },
    [rito],
  );

  const loadDemo = useCallback(async () => {
    await rito.load(fetchDemoEpubData());
  }, [rito]);

  const toggleSpreadMode = useCallback(() => {
    setSpreadModeState((prev) => {
      const next = prev === 'single' ? 'double' : 'single';
      rito.setSpreadMode(next);
      return next;
    });
  }, [rito]);

  const setSpreadMode = useCallback(
    (mode: 'single' | 'double') => {
      setSpreadModeState((prev) => {
        if (prev === mode) return prev;
        rito.setSpreadMode(mode);
        return mode;
      });
    },
    [rito],
  );

  const setLineBreaking = useCallback(
    (mode: ReaderLineBreaking) => {
      setLineBreakingState((prev) => {
        if (prev === mode) return prev;
        rito.setLineBreaking(mode);
        return mode;
      });
    },
    [rito],
  );

  const increaseZoom = useCallback(() => {
    setZoomScale((s) => Math.min(s + ZOOM_SCALE_STEP, ZOOM_SCALE_MAX));
  }, []);

  const decreaseZoom = useCallback(() => {
    setZoomScale((s) => Math.max(s - ZOOM_SCALE_STEP, ZOOM_SCALE_MIN));
  }, []);

  const setZoomScaleClamped = useCallback((v: number) => {
    setZoomScale(Math.max(ZOOM_SCALE_MIN, Math.min(v, ZOOM_SCALE_MAX)));
  }, []);

  // Moving the slider activates the override (a no-op slider would be confusing).
  const setLineHeight = useCallback((v: number) => {
    setLineHeightState(v);
    setLineHeightActive(true);
  }, []);

  const setLineHeightForce = useCallback((v: boolean) => {
    setLineHeightForceState(v);
    setLineHeightActive(true);
  }, []);

  // Restore initial state: slider snaps back to default, override cleared, force off.
  const useBookLineHeight = useCallback(() => {
    setLineHeightState(DEFAULT_SETTINGS.lineHeight);
    setLineHeightActive(false);
    setLineHeightForceState(false);
  }, []);

  const setFontFamily = useCallback((v: string | null) => {
    setFontFamilyState(v);
  }, []);

  const navigateToTocEntry = useCallback(
    (entry: TocEntry) => {
      rito.navigateToTocEntry(entry);
    },
    [rito],
  );

  const bookTitle = rito.metadata?.title ?? '';
  const activeChapterHref = (() => {
    const ctrl = rito.controller;
    if (!ctrl || rito.spreads.length === 0) return '';
    const spread = rito.spreads[rito.currentSpread];
    const pageIndex = spread?.left?.index ?? 0;
    return ctrl.reader.findActiveTocEntry(pageIndex)?.href ?? '';
  })();

  return {
    ...rito,
    selection,
    search,
    annotations,
    spreadMode,
    zoomScale,
    lineHeight,
    lineHeightActive,
    lineHeightForce,
    fontFamily,
    lineBreaking,
    isTransitioning,
    bookTitle,
    activeChapterHref,
    loadFromArrayBuffer,
    loadDemo,
    navigateToTocEntry,
    toggleSpreadMode,
    setSpreadMode,
    setLineBreaking,
    increaseZoom,
    decreaseZoom,
    setZoomScale: setZoomScaleClamped,
    setLineHeight,
    setLineHeightForce,
    useBookLineHeight,
    setFontFamily,
    // Content interaction
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
