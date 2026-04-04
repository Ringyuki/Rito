import type { PackageMetadata, Page, Reader, ReaderOptions, Spread, TocEntry } from 'rito';
import type {
  Annotation,
  AnnotationInput,
  AnnotationPatch,
  StorageAdapter,
} from 'rito/annotations';
import type { ReadingPosition } from 'rito/position';
import type { SearchResult } from 'rito/search';
import type { TextRange } from 'rito/selection';
import type { TransitionOptions } from '../transition/types';
import type { PositionStorageAdapter } from '../storage/types';
import type { OverlayRenderer } from '../overlay/types';
import type { TransitionEngine } from '../transition/types';
import type { TypedEmitter } from '../utils/event-emitter';

export interface ReaderControllerOptions extends ReaderOptions {
  readonly transition?: Partial<TransitionOptions> | undefined;
  readonly annotationStorage?: StorageAdapter | undefined;
  readonly positionStorage?: PositionStorageAdapter | undefined;
}

export interface ReaderControllerEvents {
  spreadChange: { spreadIndex: number; spread: Spread };
  selectionChange: { range: TextRange | null; text: string; rects: readonly Rect[] };
  searchResults: { results: readonly SearchResult[]; activeIndex: number };
  searchActiveChange: { activeIndex: number; result: SearchResult | undefined };
  annotationsChange: { annotations: readonly Annotation[] };
  positionChange: { position: ReadingPosition };
  loadStart: undefined;
  loadEnd: { success: boolean; error?: string };
  layoutChange: { spreads: readonly Spread[]; totalSpreads: number };
  transitionStart: { direction: 'forward' | 'backward' };
  transitionEnd: { direction: 'forward' | 'backward' };
  error: { message: string; source: string };
}

interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type InteractionMode = 'selection' | 'gesture';

export interface ReaderController {
  load(data: ArrayBuffer): Promise<void>;
  mount(container: HTMLElement): void;
  dispose(): void;

  readonly isLoaded: boolean;
  readonly isLoading: boolean;
  readonly metadata: PackageMetadata | null;
  readonly toc: readonly TocEntry[];
  readonly spreads: readonly Spread[];
  readonly pages: readonly Page[];
  readonly currentSpread: number;
  readonly totalSpreads: number;

  goToSpread(index: number): void;
  nextSpread(): void;
  prevSpread(): void;
  navigateToTocEntry(entry: TocEntry): void;

  resize(width: number, height: number): void;
  setSpreadMode(mode: 'single' | 'double'): void;
  setTheme(options: { backgroundColor?: string; foregroundColor?: string }): void;
  setTypography(opts: { fontSize?: number; lineHeight?: number; fontFamily?: string }): boolean;

  search(query: string): void;
  searchNext(): SearchResult | undefined;
  searchPrev(): SearchResult | undefined;
  clearSearch(): void;
  readonly searchResults: readonly SearchResult[];
  readonly searchActiveIndex: number;

  clearSelection(): void;
  readonly selectionText: string;
  readonly selectionRange: TextRange | null;

  addAnnotation(input: Omit<AnnotationInput, 'pageIndex'>): Annotation | undefined;
  removeAnnotation(id: string): boolean;
  updateAnnotation(id: string, patch: AnnotationPatch): boolean;
  readonly annotations: readonly Annotation[];

  restorePosition(): number | undefined;
  savePosition(): void;

  setInteractionMode(mode: InteractionMode): void;
  readonly interactionMode: InteractionMode;
  configureTransition(options: Partial<TransitionOptions>): void;

  on<K extends keyof ReaderControllerEvents>(
    event: K,
    handler: (data: ReaderControllerEvents[K]) => void,
  ): () => void;

  readonly reader: Reader | null;
  readonly transitionEngine: TransitionEngine;
  readonly overlayRenderer: OverlayRenderer;
  readonly emitter: TypedEmitter<ReaderControllerEvents>;
}
