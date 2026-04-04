import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type Dispatch,
  type RefObject,
  type SetStateAction,
} from 'react';
import { createReader } from 'rito';
import type { Reader } from 'rito';
import demoEpubUrl from '@/assets/demo.epub?url';
import { getThemeOptions, getViewportSize, type EpubState } from './epub-shared';
import type { ContainerSize } from './use-container-size';

export type DrawSpread = (reader: Reader, index: number, scale: number) => void;

interface EpubController {
  readonly canvasRef: RefObject<HTMLCanvasElement | null>;
  readonly readerRef: RefObject<Reader | null>;
  readonly state: EpubState;
  readonly setState: Dispatch<SetStateAction<EpubState>>;
  readonly draw: DrawSpread;
  readonly loadFromArrayBuffer: (data: ArrayBuffer, name: string) => Promise<void>;
  readonly loadDemo: () => Promise<void>;
}

export function useEpubController(
  containerSize: ContainerSize,
  theme: 'light' | 'dark',
): EpubController {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const readerRef = useRef<Reader | null>(null);
  const prevContainerRef = useRef({ width: 0, height: 0 });
  const [state, setState] = useState<EpubState>({
    isLoaded: false,
    isLoading: false,
    error: null,
    spreads: [],
    currentSpread: 0,
    toc: [],
    spreadMode: 'double',
    fontScale: 1.2,
  });

  const draw = useCallback<DrawSpread>(
    (reader, index, scale) => {
      if (!canvasRef.current) return;
      reader.setTheme(getThemeOptions(theme));
      reader.renderSpread(index, scale);
    },
    [theme],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    const reader = readerRef.current;
    if (!reader || !canvas || containerSize.width === 0 || containerSize.height === 0) return;
    const { width, height } = getViewportSize(containerSize, state.fontScale);
    const containerChanged =
      containerSize.width !== prevContainerRef.current.width ||
      containerSize.height !== prevContainerRef.current.height;
    prevContainerRef.current = { width: containerSize.width, height: containerSize.height };

    const updateLayout = () => {
      const changed = reader.updateLayout(width, height, state.spreadMode);
      if (!changed) return;

      setState((current) => {
        const clamped = Math.max(0, Math.min(current.currentSpread, reader.totalSpreads - 1));
        draw(reader, clamped, current.fontScale);
        return {
          ...current,
          spreads: reader.spreads,
          toc: reader.toc,
          currentSpread: clamped,
        };
      });
    };

    if (containerChanged) {
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);

      const timer = setTimeout(updateLayout, 200);
      return () => {
        clearTimeout(timer);
      };
    }

    updateLayout();
    return undefined;
  }, [
    containerSize.height,
    containerSize.width,
    draw,
    state.fontScale,
    state.isLoaded,
    state.spreadMode,
  ]);

  useEffect(() => {
    const reader = readerRef.current;
    if (!reader || !state.isLoaded) return;
    draw(reader, state.currentSpread, state.fontScale);
  }, [draw, state.currentSpread, state.fontScale, state.isLoaded]);

  const loadFromArrayBuffer = useCallback(
    async (data: ArrayBuffer, name: string) => {
      void name;
      setState((current) => ({ ...current, isLoading: true, error: null }));

      try {
        const canvas = canvasRef.current;
        if (!canvas) throw new Error('Canvas not ready');

        readerRef.current?.dispose();
        const { width, height } = getViewportSize(containerSize, state.fontScale);
        const reader = await createReader(data, canvas, {
          width,
          height,
          margin: 40,
          spread: state.spreadMode,
          ...getThemeOptions(theme),
        });
        readerRef.current = reader;
        setState((current) => ({
          ...current,
          isLoaded: true,
          isLoading: false,
          spreads: reader.spreads,
          currentSpread: 0,
          toc: reader.toc,
        }));
        prevContainerRef.current = { width: containerSize.width, height: containerSize.height };
        draw(reader, 0, state.fontScale);
      } catch (error) {
        setState((current) => ({
          ...current,
          isLoading: false,
          error: error instanceof Error ? error.message : String(error),
        }));
      }
    },
    [containerSize.height, containerSize.width, draw, state.fontScale, state.spreadMode, theme],
  );

  const loadDemo = useCallback(async () => {
    setState((current) => ({ ...current, isLoading: true, error: null }));
    try {
      const response = await fetch(demoEpubUrl);
      if (!response.ok) throw new Error(`HTTP ${String(response.status)}`);
      const data = await response.arrayBuffer();
      await loadFromArrayBuffer(data, 'demo.epub');
    } catch (error) {
      setState((current) => ({
        ...current,
        isLoading: false,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  }, [loadFromArrayBuffer]);

  return { canvasRef, readerRef, state, setState, draw, loadFromArrayBuffer, loadDemo };
}
