import type {
  ReaderLocator,
  ReaderTextRange,
  ReaderTextPoint,
  ReaderTextSelectionInteractions,
} from '@ritojs/core';

export type NativeSelectionPoint = ReaderTextPoint;
export type NativeSelectionGranularity = 'character' | 'word' | 'paragraph';
export type NativeSelectionHandleEdge = 'start' | 'end';
export type NativeSelectionCapability = ReaderTextSelectionInteractions;
export type NativeSelectionState = 'idle' | 'selecting' | 'selected' | 'disposed';
export type NativeSelectionFocusDirection = 'forward' | 'backward';

/** Exact native selection data. Rectangles remain in page-content coordinates. */
export interface NativeSelectionSnapshot {
  readonly range: ReaderTextRange;
  readonly text: string;
  readonly rects: ReaderTextRange['rects'];
  readonly sourceLocator: ReaderLocator;
  readonly focusDirection: NativeSelectionFocusDirection;
  readonly focusCaret: {
    readonly pageIndex: number;
    readonly geometry: ReaderTextRange['focus']['geometry'];
  };
}

export interface NativeSelectionChange {
  readonly state: NativeSelectionState;
  readonly snapshot: NativeSelectionSnapshot | null;
}

export interface NativeSelectionEngineOptions {
  readonly onError?: ((error: unknown) => void) | undefined;
}

export interface NativeSelectionHandleDrag {
  update(point: NativeSelectionPoint): void;
  finish(point: NativeSelectionPoint): void;
  cancel(): void;
}

export interface NativeSelectionEngine {
  beginHandleDrag(edge: NativeSelectionHandleEdge): NativeSelectionHandleDrag | null;
  handlePointerDown(point: NativeSelectionPoint, granularity?: NativeSelectionGranularity): void;
  handlePointerMove(point: NativeSelectionPoint): void;
  handlePointerUp(point: NativeSelectionPoint): void;
  clear(): void;
  invalidate(): void;
  dispose(): void;
  getState(): NativeSelectionState;
  getSnapshot(): NativeSelectionSnapshot | null;
  onChange(listener: (change: NativeSelectionChange) => void): () => void;
}
