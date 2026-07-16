import type { ReaderTextCaret, ReaderTextRange } from '@ritojs/core';
import type {
  NativeSelectionCapability,
  NativeSelectionChange,
  NativeSelectionEngineOptions,
  NativeSelectionGranularity,
  NativeSelectionPoint,
  NativeSelectionSnapshot,
  NativeSelectionState,
} from './native-types';

export interface NativeSelectionFocusSample {
  readonly sequence: number;
  readonly point: NativeSelectionPoint;
  readonly final: boolean;
}

/** A move result settled after release; cancellation invalidates older captured geometry. */
export type NativeSelectionMoveFallback =
  | { readonly status: 'resolved'; readonly snapshot: NativeSelectionSnapshot }
  | { readonly status: 'collapsed' }
  | { readonly status: 'unresolved' }
  | { readonly status: 'cancelled' };

export interface NativeSelectionGestureSession {
  readonly epoch: number;
  readonly granularity: NativeSelectionGranularity;
  readonly anchorPoint: NativeSelectionPoint | undefined;
  anchor: ReaderTextCaret | undefined;
  latestSequence: number;
  queued: NativeSelectionFocusSample | undefined;
  moveInFlight: boolean;
  finalInFlight: boolean;
  moveFallback: NativeSelectionMoveFallback | undefined;
  finalFallbackRequested: boolean;
  ended: boolean;
}

export interface NativeSelectionEngineData {
  readonly capability: NativeSelectionCapability;
  readonly options: NativeSelectionEngineOptions;
  readonly listeners: Set<(change: NativeSelectionChange) => void>;
  epoch: number;
  state: NativeSelectionState;
  snapshot: NativeSelectionSnapshot | null;
  session: NativeSelectionGestureSession | undefined;
}

export function createNativeSelectionEngineData(
  capability: NativeSelectionCapability,
  options: NativeSelectionEngineOptions,
): NativeSelectionEngineData {
  return {
    capability,
    options,
    listeners: new Set(),
    epoch: 0,
    state: 'idle',
    snapshot: null,
    session: undefined,
  };
}

export function finishNativeSelection(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  snapshot: NativeSelectionSnapshot | undefined,
): void {
  if (!isCurrentNativeSelection(data, session)) return;
  data.session = undefined;
  publishNativeSelection(data, snapshot ? 'selected' : 'idle', snapshot ?? null);
}

export function finishWithLastNativeSelection(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
): void {
  finishNativeSelection(data, session, data.snapshot ?? undefined);
}

export function cancelNativeSelection(
  data: NativeSelectionEngineData,
  nextState: Extract<NativeSelectionState, 'idle' | 'disposed'>,
  notify: boolean,
): void {
  if (data.state === 'disposed') return;
  data.epoch += 1;
  data.session = undefined;
  if (notify) publishNativeSelection(data, nextState, null);
  else {
    data.state = nextState;
    data.snapshot = null;
  }
}

export function disposeNativeSelection(data: NativeSelectionEngineData): void {
  if (data.state === 'disposed') return;
  cancelNativeSelection(data, 'disposed', false);
  data.listeners.clear();
}

export function isCurrentNativeSelection(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
): boolean {
  return data.state !== 'disposed' && data.session === session && data.epoch === session.epoch;
}

export function toNativeSelectionSnapshot(range: ReaderTextRange): NativeSelectionSnapshot {
  return {
    range,
    text: range.selectedText,
    rects: range.rects,
    sourceLocator: range.sourceLocator,
    focusDirection: range.focus === range.end ? 'forward' : 'backward',
    focusCaret: { pageIndex: range.focus.pageIndex, geometry: range.focus.geometry },
  };
}

export function publishNativeSelection(
  data: NativeSelectionEngineData,
  state: NativeSelectionState,
  snapshot: NativeSelectionSnapshot | null,
): void {
  if (data.state === state && data.snapshot === snapshot) return;
  data.state = state;
  data.snapshot = snapshot;
  const change: NativeSelectionChange = { state, snapshot };
  for (const listener of data.listeners) {
    try {
      listener(change);
    } catch (error: unknown) {
      reportNativeSelectionError(data, error);
    }
  }
}

export function subscribeNativeSelection(
  data: NativeSelectionEngineData,
  listener: (change: NativeSelectionChange) => void,
): () => void {
  if (data.state === 'disposed') return () => undefined;
  data.listeners.add(listener);
  return () => data.listeners.delete(listener);
}

export function reportNativeSelectionError(data: NativeSelectionEngineData, error: unknown): void {
  try {
    data.options.onError?.(error);
  } catch {
    // Error reporting must not create an unhandled rejection from a void input method.
  }
}
