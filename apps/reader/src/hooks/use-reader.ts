import { useCallback, useEffect, useState } from 'react';
import type { TocEntry } from 'rito';
import type { ReaderControllerEvents } from '@rito/kit';
import {
  useRitoReader,
  useSelection,
  useSearch,
  useAnnotations,
  useControllerEvent,
} from '@rito/react';
import { createLocalStoragePositionAdapter, createLocalStorageAnnotationAdapter } from '@rito/kit';
import demoEpubUrl from '@/assets/demo.epub?url';

const FONT_SCALE_STEP = 0.1;
const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 2.0;

export type FontPreset = 'default' | 'serif' | 'sans' | 'mono';

const FONT_STACKS: Record<Exclude<FontPreset, 'default'>, string> = {
  serif: 'Georgia, "Times New Roman", serif',
  sans: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

const positionStorage = createLocalStoragePositionAdapter('rito-position');
const annotationStorage = createLocalStorageAnnotationAdapter('rito-annotations');

function getThemeOptions(theme: 'light' | 'dark') {
  if (theme === 'dark') return { backgroundColor: '#1a1a1a', foregroundColor: '#e5e5e5' };
  return { backgroundColor: '#ffffff' };
}

export function useReader(
  theme: 'light' | 'dark',
  containerWidth: number,
  containerHeight: number,
) {
  const [spreadMode, setSpreadModeState] = useState<'single' | 'double'>('double');
  const [fontScale, setFontScale] = useState(1.2);
  const [lineHeight, setLineHeightState] = useState(1.5);
  const [fontPreset, setFontPresetState] = useState<FontPreset>('default');

  const vpWidth = containerWidth > 0 ? Math.round(containerWidth / fontScale) : 0;
  const vpHeight = containerHeight > 0 ? Math.round(containerHeight / fontScale) : 0;
  const margin = containerWidth < 640 ? 16 : containerWidth < 1024 ? 32 : 50;

  const rito = useRitoReader({
    reader: {
      width: vpWidth,
      height: vpHeight,
      margin,
      spread: spreadMode,
      ...getThemeOptions(theme),
    },
    controller: {
      transition: { stiffness: 180, damping: 22 },
      positionStorage,
      annotationStorage,
      a11y: {
        enabled: true,
      },
    },
  });

  const selection = useSelection(rito.controller);
  const search = useSearch(rito.controller);
  const annotations = useAnnotations(rito.controller);

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

  // Disable keyboard navigation while lightbox is open (including exit animation)
  useEffect(() => {
    rito.controller?.keyboard.setEnabled(!lightboxActive);
  }, [lightboxActive, rito.controller]);

  const [searchOpen, setSearchOpen] = useState(false);

  // Resize + renderScale (only when values actually change, not on every render)
  useEffect(() => {
    if (vpWidth === 0 || !rito.controller) return;
    rito.setRenderScale(fontScale);
    rito.resize(vpWidth, vpHeight, margin);
  }, [vpWidth, vpHeight, fontScale, margin, rito.controller]);

  // Sync theme
  useEffect(() => {
    if (!rito.controller) return;
    rito.setTheme(getThemeOptions(theme));
  }, [theme, rito.controller]);

  // Sync typography (lineHeight + fontPreset) when they change after load.
  // Skipped until the reader is loaded: setTypography is a no-op without a document.
  useEffect(() => {
    if (!rito.controller || !rito.isLoaded) return;
    const fontFamily = fontPreset === 'default' ? undefined : FONT_STACKS[fontPreset];
    rito.setTypography({
      lineHeight,
      ...(fontFamily !== undefined ? { fontFamily } : {}),
    });
  }, [lineHeight, fontPreset, rito.controller, rito.isLoaded]);

  // Restore position after load
  useEffect(() => {
    if (!rito.isLoaded || !rito.controller) return;
    void rito.controller.restorePosition().then((idx) => {
      if (idx !== undefined) rito.goToSpread(idx);
    });
  }, [rito.isLoaded]);

  // Actions
  const loadFromArrayBuffer = useCallback(
    async (data: ArrayBuffer) => {
      await rito.load(data);
    },
    [rito],
  );

  const loadDemo = useCallback(async () => {
    await rito.load(
      fetch(demoEpubUrl).then(async (resp) => {
        if (!resp.ok) throw new Error(`HTTP ${String(resp.status)}`);
        return resp.arrayBuffer();
      }),
    );
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

  const increaseFontSize = useCallback(() => {
    setFontScale((s) => Math.min(s + FONT_SCALE_STEP, FONT_SCALE_MAX));
  }, []);

  const decreaseFontSize = useCallback(() => {
    setFontScale((s) => Math.max(s - FONT_SCALE_STEP, FONT_SCALE_MIN));
  }, []);

  const setFontScaleClamped = useCallback((v: number) => {
    setFontScale(Math.max(FONT_SCALE_MIN, Math.min(v, FONT_SCALE_MAX)));
  }, []);

  const setLineHeight = useCallback((v: number) => {
    setLineHeightState(v);
  }, []);

  const setFontPreset = useCallback((v: FontPreset) => {
    setFontPresetState(v);
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
    fontScale,
    lineHeight,
    fontPreset,
    bookTitle,
    activeChapterHref,
    loadFromArrayBuffer,
    loadDemo,
    navigateToTocEntry,
    toggleSpreadMode,
    setSpreadMode,
    increaseFontSize,
    decreaseFontSize,
    setFontScale: setFontScaleClamped,
    setLineHeight,
    setFontPreset,
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
