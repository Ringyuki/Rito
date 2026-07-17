import type {
  ReaderDocumentSourceSpan,
  ReaderLocator,
  ReaderTextSelectionMovement,
  ReaderTextSelectionMovementResolution,
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

export interface SelectionSpreadUpdate {
  /** Keep an active native handle session while only the visible projection changes. */
  readonly preserveNativeHandleDrag?: boolean;
}

/** Exact native selection data. Rectangles remain in page-content coordinates. */
export interface NativeSelectionSnapshot {
  readonly range: ReaderTextRange;
  readonly text: string;
  readonly rects: ReaderTextRange['rects'];
  readonly sourceSpan: ReaderDocumentSourceSpan;
  readonly sourceLocator: ReaderLocator | null;
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

/** Opaque lease for one exact active gesture session. */
export interface NativeSelectionGestureLease {
  isActive(): boolean;
}

export type NativeSelectionKeyboardOutcome =
  | ReaderTextSelectionMovementResolution
  | { readonly status: 'cancelled' };

/** One serialized keyboard movement whose revision and projection lease stay live until finish. */
export interface NativeSelectionKeyboardCommand {
  readonly result: Promise<NativeSelectionKeyboardOutcome>;
  /** Publish the settled result synchronously after the controller revalidates its ownership. */
  commit(): boolean;
  isActive(): boolean;
  finish(): void;
}

export interface NativeSelectionEngine {
  beginHandleDrag(edge: NativeSelectionHandleEdge): NativeSelectionHandleDrag | null;
  handlePointerDown(point: NativeSelectionPoint, granularity?: NativeSelectionGranularity): void;
  handlePointerMove(point: NativeSelectionPoint): void;
  handlePointerUp(point: NativeSelectionPoint): void;
  /** Preserve revision-stable state and replay the latest gesture sample on an appended revision. */
  acceptRevisionAppend(): void;
  clear(): void;
  invalidate(): void;
  dispose(): void;
  getState(): NativeSelectionState;
  getInteractionGeneration(): number;
  getSnapshot(): NativeSelectionSnapshot | null;
  captureActiveGesture(): NativeSelectionGestureLease | null;
  hasActiveHandleDrag(): boolean;
  canExtendKeyboardSelection(): boolean;
  beginKeyboardMovement(
    movement: ReaderTextSelectionMovement,
  ): NativeSelectionKeyboardCommand | null;
  onChange(listener: (change: NativeSelectionChange) => void): () => void;
}
