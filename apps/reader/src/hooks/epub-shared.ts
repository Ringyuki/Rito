import type { Reader, Spread, TocEntry } from 'rito';
import type { ContainerSize } from './use-container-size';

export interface EpubState {
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  spreads: readonly Spread[];
  currentSpread: number;
  toc: readonly TocEntry[];
  spreadMode: 'single' | 'double';
  fontScale: number;
}

export const PADDING = 48;
export const MIN_SIZE = 200;
export const FONT_SCALE_STEP = 0.1;
export const FONT_SCALE_MIN = 0.5;
export const FONT_SCALE_MAX = 2.0;

export function getThemeOptions(theme: 'light' | 'dark'): {
  backgroundColor: string;
  foregroundColor?: string;
} {
  if (theme === 'dark') return { backgroundColor: '#1a1a1a', foregroundColor: '#e5e5e5' };
  return { backgroundColor: '#ffffff' };
}

export function getViewportSize(
  containerSize: ContainerSize,
  scale: number,
): { width: number; height: number } {
  return {
    width: Math.round(Math.max((containerSize.width - PADDING) / scale, MIN_SIZE)),
    height: Math.round(Math.max((containerSize.height - PADDING) / scale, MIN_SIZE)),
  };
}

export function getCanvasSize(
  containerSize: ContainerSize,
  fontScale: number,
): { width: number; height: number } {
  if (containerSize.width <= 0 || containerSize.height <= 0) return { width: 0, height: 0 };
  const { width, height } = getViewportSize(containerSize, fontScale);
  return {
    width: Math.round(width * fontScale),
    height: Math.round(height * fontScale),
  };
}

export function getActiveChapterHref(
  reader: Reader | null,
  spreads: readonly Spread[],
  currentSpread: number,
): string {
  if (!reader || spreads.length === 0) return '';
  const spread = spreads[currentSpread];
  const pageIndex = spread?.left?.index ?? 0;
  return reader.findActiveTocEntry(pageIndex)?.href ?? '';
}
