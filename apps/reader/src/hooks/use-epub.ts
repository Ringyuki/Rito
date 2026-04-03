import { useCallback, useEffect, useRef, useState } from 'react';
import {
  loadEpub,
  prepare,
  render,
  getSpreadDimensions,
  buildSpreads,
  createLayoutConfig,
  findPageForTocEntry,
  disposeResources,
} from 'rito';
import type {
  ChapterRange,
  EpubDocument,
  LayoutConfig,
  Page,
  Resources,
  Spread,
  TocEntry,
} from 'rito';
import type { ContainerSize } from './use-container-size';

interface EpubState {
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  fileName: string;
  pages: readonly Page[];
  spreads: readonly Spread[];
  currentSpread: number;
  toc: readonly TocEntry[];
  spreadMode: 'single' | 'double';
  fontScale: number;
}

const PADDING = 48;
const FONT_SCALE_STEP = 0.1;
const FONT_SCALE_MIN = 0.5;
const FONT_SCALE_MAX = 2.0;
const SPREAD_GAP = 20;
const MIN_SIZE = 200;

const THEME_COLORS = {
  light: { backgroundColor: '#ffffff', foregroundColor: undefined },
  dark: { backgroundColor: '#1a1a1a', foregroundColor: '#e5e5e5' },
} as const;

export function useEpub(containerSize: ContainerSize, theme: 'light' | 'dark') {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resourcesRef = useRef<Resources | null>(null);
  const docRef = useRef<EpubDocument | null>(null);

  const [state, setState] = useState<EpubState>({
    isLoaded: false,
    isLoading: false,
    error: null,
    fileName: '',
    pages: [],
    spreads: [],
    currentSpread: 0,
    toc: [],
    spreadMode: 'double',
    fontScale: 1.0,
  });

  const buildConfig = useCallback(
    (mode: 'single' | 'double', size: ContainerSize, scale: number): LayoutConfig =>
      createLayoutConfig({
        width: Math.max((size.width - PADDING) / scale, MIN_SIZE),
        height: Math.max((size.height - PADDING) / scale, MIN_SIZE),
        margin: 40,
        spread: mode,
        spreadGap: SPREAD_GAP,
      }),
    [],
  );

  const drawSpread = useCallback(
    (
      spreads: readonly Spread[],
      index: number,
      config: LayoutConfig,
      t: 'light' | 'dark',
      scale: number,
    ) => {
      const canvas = canvasRef.current;
      if (!canvas || spreads.length === 0) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      const spread = spreads[index];
      if (!spread) return;

      // Canvas physical size = layout logical size * fontScale
      const dims = getSpreadDimensions(config, scale);
      canvas.width = dims.width;
      canvas.height = dims.height;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      const images = resourcesRef.current?.images;
      const colors = THEME_COLORS[t];
      const opts: Record<string, unknown> = {
        backgroundColor: colors.backgroundColor,
        pixelRatio: scale,
      };
      if (colors.foregroundColor) opts['foregroundColor'] = colors.foregroundColor;
      if (images) opts['images'] = images;
      render(spread, ctx, config, opts as Parameters<typeof render>[3]);
    },
    [],
  );

  // Re-paginate when container size or spread mode changes
  useEffect(() => {
    const doc = docRef.current;
    const canvas = canvasRef.current;
    if (!doc || !canvas || containerSize.width === 0 || containerSize.height === 0) return;

    let cancelled = false;

    const timer = setTimeout(async () => {
      const config = buildConfig(state.spreadMode, containerSize, state.fontScale);
      try {
        const resources = await prepare(doc, config, canvas);
        if (cancelled) return;
        resourcesRef.current = resources;
        const pages = resources.pages;
        const chapterStarts = getChapterStartPages(resources.chapterMap);
        const newSpreads = buildSpreads(pages, config, chapterStarts);

        const clampedIdx = Math.max(0, Math.min(state.currentSpread, newSpreads.length - 1));
        setState((s) => ({ ...s, pages, spreads: newSpreads, currentSpread: clampedIdx }));
        drawSpread(newSpreads, clampedIdx, config, theme, state.fontScale);
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

  // Re-render (no re-pagination) when theme changes
  useEffect(() => {
    if (!state.isLoaded || state.spreads.length === 0) return;
    const config = buildConfig(state.spreadMode, containerSize, state.fontScale);
    drawSpread(state.spreads, state.currentSpread, config, theme, state.fontScale);
  }, [theme]);

  const loadFromArrayBuffer = useCallback(
    async (data: ArrayBuffer, name: string) => {
      setState((s) => ({ ...s, isLoading: true, error: null }));

      try {
        if (resourcesRef.current) {
          disposeResources(resourcesRef.current);
        }

        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Canvas not ready');

        const doc = loadEpub(data);
        docRef.current = doc;

        const config = buildConfig(state.spreadMode, containerSize, state.fontScale);
        const resources = await prepare(doc, config, canvas);
        resourcesRef.current = resources;

        const pages = resources.pages;
        const chapterStarts = getChapterStartPages(resources.chapterMap);
        const spreads = buildSpreads(pages, config, chapterStarts);

        setState((s) => ({
          ...s,
          isLoaded: true,
          isLoading: false,
          fileName: name,
          pages,
          spreads,
          currentSpread: 0,
          toc: doc.toc,
        }));

        drawSpread(spreads, 0, config, theme, state.fontScale);
      } catch (err) {
        setState((s) => ({
          ...s,
          isLoading: false,
          error: err instanceof Error ? err.message : String(err),
        }));
      }
    },
    [buildConfig, drawSpread, state.spreadMode, containerSize, theme],
  );

  const loadDemo = useCallback(async () => {
    setState((s) => ({ ...s, isLoading: true, error: null }));
    try {
      const response = await fetch('/demo.epub');
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
      setState((s) => {
        if (index < 0 || index >= s.spreads.length) return s;
        const config = buildConfig(s.spreadMode, containerSize, s.fontScale);
        drawSpread(s.spreads, index, config, theme, s.fontScale);
        return { ...s, currentSpread: index };
      });
    },
    [buildConfig, drawSpread, containerSize, theme],
  );

  const nextSpread = useCallback(() => {
    setState((s) => {
      if (s.currentSpread >= s.spreads.length - 1) return s;
      const next = s.currentSpread + 1;
      const config = buildConfig(s.spreadMode, containerSize, s.fontScale);
      drawSpread(s.spreads, next, config, theme, s.fontScale);
      return { ...s, currentSpread: next };
    });
  }, [buildConfig, drawSpread, containerSize, theme]);

  const prevSpread = useCallback(() => {
    setState((s) => {
      if (s.currentSpread <= 0) return s;
      const prev = s.currentSpread - 1;
      const config = buildConfig(s.spreadMode, containerSize, s.fontScale);
      drawSpread(s.spreads, prev, config, theme, s.fontScale);
      return { ...s, currentSpread: prev };
    });
  }, [buildConfig, drawSpread, containerSize, theme]);

  const toggleSpreadMode = useCallback(() => {
    setState((s) => ({
      ...s,
      spreadMode: s.spreadMode === 'single' ? 'double' : 'single',
    }));
    // The useEffect above handles re-pagination
  }, []);

  const navigateToTocEntry = useCallback(
    (entry: TocEntry) => {
      const doc = docRef.current;
      const resources = resourcesRef.current;
      if (!doc || !resources) return;

      const manifestHrefs = new Map(
        doc.packageDocument.manifest.map(
          (item: { id: string; href: string }) => [item.id, item.href] as const,
        ),
      );
      const pageIndex = findPageForTocEntry(
        entry,
        resources.chapterMap,
        doc.packageDocument.spine,
        manifestHrefs,
      );
      if (pageIndex === undefined) return;

      setState((s) => {
        for (let i = 0; i < s.spreads.length; i++) {
          const sp = s.spreads[i];
          if (sp?.left?.index === pageIndex || sp?.right?.index === pageIndex) {
            const config = buildConfig(s.spreadMode, containerSize, s.fontScale);
            drawSpread(s.spreads, i, config, theme, s.fontScale);
            return { ...s, currentSpread: i };
          }
        }
        return s;
      });
    },
    [buildConfig, drawSpread, containerSize, theme],
  );

  const increaseFontSize = useCallback(() => {
    setState((s) => ({
      ...s,
      fontScale: Math.min(s.fontScale + FONT_SCALE_STEP, FONT_SCALE_MAX),
    }));
  }, []);

  const decreaseFontSize = useCallback(() => {
    setState((s) => ({
      ...s,
      fontScale: Math.max(s.fontScale - FONT_SCALE_STEP, FONT_SCALE_MIN),
    }));
  }, []);

  const config = buildConfig(state.spreadMode, containerSize, state.fontScale);
  const canvasSize =
    containerSize.width > 0 && containerSize.height > 0
      ? getSpreadDimensions(config, state.fontScale)
      : { width: 0, height: 0 };

  // Compute active chapter href for TOC highlighting
  const currentSpreadObj = state.spreads[state.currentSpread];
  const currentPageIndex = currentSpreadObj?.left?.index ?? 0;
  const chapterMap: ReadonlyMap<string, ChapterRange> =
    resourcesRef.current?.chapterMap ?? new Map<string, ChapterRange>();
  const doc = docRef.current;

  let activeChapterHref = '';
  if (doc) {
    const manifestById = new Map(doc.packageDocument.manifest.map((m) => [m.id, m.href]));
    for (const spineItem of doc.packageDocument.spine) {
      const range = chapterMap.get(spineItem.idref);
      if (range && currentPageIndex >= range.startPage && currentPageIndex <= range.endPage) {
        activeChapterHref = manifestById.get(spineItem.idref) ?? '';
        break;
      }
    }
  }

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

/** Extract the set of page indices that start a new chapter. */
function getChapterStartPages(chapterMap: ReadonlyMap<string, ChapterRange>): Set<number> {
  const starts = new Set<number>();
  for (const range of chapterMap.values()) {
    starts.add(range.startPage);
  }
  return starts;
}
