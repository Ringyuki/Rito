import { useCallback, useEffect, useRef, useState } from 'react';
import { createReader } from 'rito';
import demoEpubUrl from '@/assets/demo.epub?url';
import type { Reader, TocEntry, ChapterRange, Spread } from 'rito';
import type { ContainerSize } from './use-container-size';

interface EpubState {
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  fileName: string;
  spreads: readonly Spread[];
  currentSpread: number;
  toc: readonly TocEntry[];
  spreadMode: 'single' | 'double';
  fontScale: number;
}

const PADDING = 48;
const MIN_SIZE = 200;
const FONT_SCALE_STEP = 0.1;
const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 2.0;

function getThemeOptions(t: 'light' | 'dark'): {
  backgroundColor: string;
  foregroundColor?: string;
} {
  if (t === 'dark') return { backgroundColor: '#1a1a1a', foregroundColor: '#e5e5e5' };
  return { backgroundColor: '#ffffff' };
}

export function useEpub(containerSize: ContainerSize, theme: 'light' | 'dark') {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readerRef = useRef<Reader | null>(null);
  const dataRef = useRef<ArrayBuffer | null>(null);
  const skipNextRebuild = useRef(false);

  const [state, setState] = useState<EpubState>({
    isLoaded: false,
    isLoading: false,
    error: null,
    fileName: '',
    spreads: [],
    currentSpread: 0,
    toc: [],
    spreadMode: 'double',
    fontScale: 1.0,
  });

  const getViewportSize = useCallback(
    (scale: number) => ({
      width: Math.max((containerSize.width - PADDING) / scale, MIN_SIZE),
      height: Math.max((containerSize.height - PADDING) / scale, MIN_SIZE),
    }),
    [containerSize],
  );

  const draw = useCallback(
    (reader: Reader, index: number, scale: number) => {
      if (!canvasRef.current) return;
      reader.setTheme(getThemeOptions(theme));
      reader.renderSpread(index, scale * window.devicePixelRatio);
    },
    [theme],
  );

  // Rebuild reader when container size, spread mode, or font scale changes
  useEffect(() => {
    const data = dataRef.current;
    const canvas = canvasRef.current;
    if (!data || !canvas || containerSize.width === 0 || containerSize.height === 0) return;

    // Skip the redundant rebuild right after initial load
    if (skipNextRebuild.current) {
      skipNextRebuild.current = false;
      return;
    }

    // Clear stale content immediately to avoid stretched rendering during debounce
    if (readerRef.current) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    let cancelled = false;

    const timer = setTimeout(async () => {
      const { width, height } = getViewportSize(state.fontScale);
      try {
        readerRef.current?.dispose();
        const reader = await createReader(data, canvas, {
          width,
          height,
          margin: 40,
          spread: state.spreadMode,
          ...getThemeOptions(theme),
        });
        if (cancelled) {
          reader.dispose();
          return;
        }
        readerRef.current = reader;

        setState((s) => {
          const clamped = Math.max(0, Math.min(s.currentSpread, reader.totalSpreads - 1));
          return { ...s, spreads: reader.spreads, toc: reader.toc, currentSpread: clamped };
        });

        const clamped = Math.max(0, Math.min(state.currentSpread, reader.totalSpreads - 1));
        draw(reader, clamped, state.fontScale);
      } catch {
        // ignore resize errors
      }
    }, 200);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    containerSize.width,
    containerSize.height,
    state.spreadMode,
    state.fontScale,
    state.isLoaded,
  ]);

  // Re-render (no rebuild) when theme changes
  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || !state.isLoaded) return;
    draw(reader, state.currentSpread, state.fontScale);
  }, [theme]);

  const loadFromArrayBuffer = useCallback(
    async (data: ArrayBuffer, name: string) => {
      setState((s) => ({ ...s, isLoading: true, error: null }));

      try {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Canvas not ready');

        dataRef.current = data;
        readerRef.current?.dispose();

        const { width, height } = getViewportSize(state.fontScale);
        const reader = await createReader(data, canvas, {
          width,
          height,
          margin: 40,
          spread: state.spreadMode,
          ...getThemeOptions(theme),
        });
        readerRef.current = reader;

        setState((s) => ({
          ...s,
          isLoaded: true,
          isLoading: false,
          fileName: name,
          spreads: reader.spreads,
          currentSpread: 0,
          toc: reader.toc,
        }));

        draw(reader, 0, state.fontScale);
        skipNextRebuild.current = true;
      } catch (err) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [getViewportSize, draw, state.spreadMode, state.fontScale, theme],
  );

  const loadDemo = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const response = await fetch(demoEpubUrl);
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const data = await response.arrayBuffer();
      await loadFromArrayBuffer(data, 'demo.epub');
    } catch (err) {
      setState((s) => ({
        ...s,
        isLoading: false,
        error: err instanceof Error ? err.message : String(err),
      }));
    }
  }, [loadFromArrayBuffer]);

  const goToSpread = useCallback(
    (index: number) => {
      const reader = readerRef.current;
      if (!reader) return;
      setState((s) => {
        if (index < 0 || index >= s.spreads.length) return s;
        draw(reader, index, s.fontScale);
        return { ...s, currentSpread: index };
      });
    },
    [draw],
  );

  const nextSpread = useCallback(() => {
    setState((s) => {
      const reader = readerRef.current;
      if (!reader || s.currentSpread >= s.spreads.length - 1) return s;
      const next = s.currentSpread + 1;
      draw(reader, next, s.fontScale);
      return { ...s, currentSpread: next };
    });
  }, [draw]);

  const prevSpread = useCallback(() => {
    setState((s) => {
      const reader = readerRef.current;
      if (!reader || s.currentSpread <= 0) return s;
      const prev = s.currentSpread - 1;
      draw(reader, prev, s.fontScale);
      return { ...s, currentSpread: prev };
    });
  }, [draw]);

  const toggleSpreadMode = useCallback(() => {
    setState((s) => ({ ...s, spreadMode: s.spreadMode === 'single' ? 'double' : 'single' }));
  }, []);

  const navigateToTocEntry = useCallback(
    (entry: TocEntry) => {
      const reader = readerRef.current;
      if (!reader) return;

      const pageIndex = reader.findPage(entry);
      if (pageIndex === undefined) return;

      const spreadIndex = reader.findSpread(pageIndex);
      if (spreadIndex === undefined) return;

      setState((s) => {
        draw(reader, spreadIndex, s.fontScale);
        return { ...s, currentSpread: spreadIndex };
      });
    },
    [draw],
  );

  const increaseFontSize = useCallback(() => {
    setState((s) => ({ ...s, fontScale: Math.min(s.fontScale + FONT_SCALE_STEP, FONT_SCALE_MAX) }));
  }, []);

  const decreaseFontSize = useCallback(() => {
    setState((s) => ({ ...s, fontScale: Math.max(s.fontScale - FONT_SCALE_STEP, FONT_SCALE_MIN) }));
  }, []);

  // Compute canvas size for the current config
  const { width: vw, height: vh } = getViewportSize(state.fontScale);
  const canvasSize =
    containerSize.width > 0 && containerSize.height > 0
      ? { width: Math.round(vw * state.fontScale), height: Math.round(vh * state.fontScale) }
      : { width: 0, height: 0 };

  // Compute active chapter href
  const reader = readerRef.current;
  let activeChapterHref = '';
  if (reader && state.spreads.length > 0) {
    const currentSpreadObj = state.spreads[state.currentSpread];
    const pageIdx = currentSpreadObj?.left?.index ?? 0;
    activeChapterHref = findActiveHref(reader.toc, pageIdx, reader);
  }

  const chapterMap: ReadonlyMap<string, ChapterRange> =
    reader?.chapterMap ?? new Map<string, ChapterRange>();

  return {
    ...state,
    canvasRef,
    canvasSize,
    activeChapterHref,
    chapterMap,
    loadFromArrayBuffer,
    loadDemo,
    goToSpread,
    nextSpread,
    prevSpread,
    toggleSpreadMode,
    navigateToTocEntry,
    increaseFontSize,
    decreaseFontSize,
  };
}

/** Find the TOC entry href that matches the current page. */
function findActiveHref(toc: readonly TocEntry[], pageIndex: number, reader: Reader): string {
  // Walk TOC entries, find the last one whose page <= current page
  let bestHref = '';
  const walk = (entries: readonly TocEntry[]): void => {
    for (const entry of entries) {
      const page = reader.findPage(entry);
      if (page !== undefined && page <= pageIndex) {
        bestHref = entry.href;
      }
      walk(entry.children);
    }
  };
  walk(toc);
  // Extract filename from href
  const path = bestHref.split('#')[0] ?? '';
  return path.split('/').pop() ?? '';
}
