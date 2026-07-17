import type { PackageMetadata, Reader, ReaderOptions, Spread, TocEntry } from '@ritojs/core';
import type {
  ControllerOptions,
  ReaderController,
  ReadingPosition,
  TransitionDriverOptions,
} from '@ritojs/kit';

export interface UseRitoReaderOptions {
  readonly reader: ReaderOptions;
  readonly controller?: ControllerOptions | undefined;
  /** Source-anchored position to resolve before the first reader frame is exposed. */
  readonly initialPosition?: ReadingPosition | null | undefined;
}

export interface RitoReaderState {
  readonly controller: ReaderController | null;
  readonly isLoaded: boolean;
  readonly isLoading: boolean;
  readonly error: string | null;
  readonly currentSpread: number;
  readonly totalSpreads: number;
  readonly metadata: PackageMetadata | null;
  readonly toc: readonly TocEntry[];
  readonly spreads: readonly Spread[];
}

export interface RitoReaderActions {
  readonly load: (data: ArrayBuffer | PromiseLike<ArrayBuffer>) => Promise<void>;
  readonly nextSpread: () => void;
  readonly prevSpread: () => void;
  readonly goToSpread: (index: number) => void;
  readonly navigateToTocEntry: (entry: TocEntry) => void;
  readonly resize: (width: number, height: number, margin?: number) => void;
  readonly setRenderScale: (scale: number) => void;
  readonly setSpreadMode: (mode: 'single' | 'double') => void;
  readonly setLineBreaking: (lineBreaking: 'greedy' | 'optimal') => boolean;
  readonly setTheme: (opts: Parameters<Reader['setTheme']>[0]) => void;
  readonly setTypography: (opts: {
    fontSize?: number | null;
    lineHeight?: number | null;
    lineHeightForce?: boolean;
    fontFamily?: string | null;
    fontFamilyForce?: boolean;
  }) => boolean;
  readonly configureTransition: (opts: Partial<TransitionDriverOptions>) => void;
}

export interface InternalState {
  isLoaded: boolean;
  isLoading: boolean;
  error: string | null;
  currentSpread: number;
  totalSpreads: number;
  metadata: PackageMetadata | null;
  toc: readonly TocEntry[];
  spreads: readonly Spread[];
}

export interface LoadedReaderStack {
  readonly reader: Reader;
  readonly ctrl: ReaderController;
}

export interface RefBox<T> {
  current: T;
}

export interface ReaderRefs {
  readonly canvasRef: RefBox<HTMLCanvasElement | null>;
  readonly readerRef: RefBox<Reader | null>;
  readonly ctrlRef: RefBox<ReaderController | null>;
  readonly detachEventsRef: RefBox<(() => void) | null>;
  readonly loadRequestIdRef: RefBox<number>;
}

export const INITIAL: InternalState = {
  isLoaded: false,
  isLoading: false,
  error: null,
  currentSpread: 0,
  totalSpreads: 0,
  metadata: null,
  toc: [],
  spreads: [],
};

export function createLoadedState(reader: Reader, controller: ReaderController): InternalState {
  const hasLayout = reader.totalSpreads > 0;
  return {
    isLoaded: hasLayout,
    isLoading: !hasLayout,
    error: null,
    currentSpread: controller.currentSpread,
    totalSpreads: reader.totalSpreads,
    metadata: reader.metadata,
    toc: reader.toc,
    spreads: reader.spreads,
  };
}
