import { useCallback, useEffect, useState } from 'react';
import type { TocEntry } from 'rito';
import { useRitoReader, useSelection, useSearch, useAnnotations } from '@rito/react';
import { createLocalStorageAdapter, createLocalStoragePositionAdapter } from '@rito/kit';
import demoEpubUrl from '@/assets/demo.epub?url';

const FONT_SCALE_STEP = 0.1;
const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 2.0;

const positionStorage = createLocalStoragePositionAdapter('rito-position');
const annotationStorage = createLocalStorageAdapter('rito-annotations');

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

  const vpWidth = containerWidth > 0 ? Math.round(containerWidth / fontScale) : 0;
  const vpHeight = containerHeight > 0 ? Math.round(containerHeight / fontScale) : 0;

  const rito = useRitoReader({
    reader: {
      width: vpWidth,
      height: vpHeight,
      margin: 50,
      spread: spreadMode,
      ...getThemeOptions(theme),
    },
    controller: {
      transition: { preset: 'slide' },
      positionStorage,
      annotationStorage,
    },
  });

  const selection = useSelection(rito.controller);
  const search = useSearch(rito.controller);
  const annotations = useAnnotations(rito.controller);

  // Resize + renderScale (only when values actually change, not on every render)
  useEffect(() => {
    if (vpWidth === 0 || !rito.controller) return;
    rito.setRenderScale(fontScale);
    rito.resize(vpWidth, vpHeight);
  }, [vpWidth, vpHeight, fontScale, rito.controller]);

  // Sync theme
  useEffect(() => {
    if (!rito.controller) return;
    rito.setTheme(getThemeOptions(theme));
  }, [theme, rito.controller]);

  // Restore position after load
  useEffect(() => {
    if (!rito.isLoaded || !rito.controller) return;
    const idx = rito.controller.restorePosition();
    if (idx !== undefined) rito.goToSpread(idx);
  }, [rito.isLoaded]);

  // Actions
  const loadFromArrayBuffer = useCallback(
    async (data: ArrayBuffer) => {
      await rito.load(data);
    },
    [rito],
  );

  const loadDemo = useCallback(async () => {
    const resp = await fetch(demoEpubUrl);
    if (!resp.ok) throw new Error(`HTTP ${String(resp.status)}`);
    await rito.load(await resp.arrayBuffer());
  }, [rito]);

  const toggleSpreadMode = useCallback(() => {
    setSpreadModeState((prev) => {
      const next = prev === 'single' ? 'double' : 'single';
      rito.setSpreadMode(next);
      return next;
    });
  }, [rito]);

  const increaseFontSize = useCallback(() => {
    setFontScale((s) => Math.min(s + FONT_SCALE_STEP, FONT_SCALE_MAX));
  }, []);

  const decreaseFontSize = useCallback(() => {
    setFontScale((s) => Math.max(s - FONT_SCALE_STEP, FONT_SCALE_MIN));
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
    bookTitle,
    activeChapterHref,
    loadFromArrayBuffer,
    loadDemo,
    navigateToTocEntry,
    toggleSpreadMode,
    increaseFontSize,
    decreaseFontSize,
  };
}
