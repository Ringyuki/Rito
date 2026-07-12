import type { ReaderSameFlowTextRange, ReaderTextCaret } from '@ritojs/core';
import type {
  NativeSelectionCapability,
  NativeSelectionChange,
  NativeSelectionEngine,
  NativeSelectionEngineOptions,
  NativeSelectionPoint,
  NativeSelectionSnapshot,
  NativeSelectionState,
} from './native-types';
import { copyNativeSelectionPoint, requireNativeSelectionPoint } from './native-point';

interface FocusSample {
  readonly sequence: number;
  readonly point: NativeSelectionPoint;
  readonly final: boolean;
}

interface GestureSession {
  readonly epoch: number;
  anchor: ReaderTextCaret | undefined;
  latestSequence: number;
  queued: FocusSample | undefined;
  moveInFlight: boolean;
  finalInFlight: boolean;
  ended: boolean;
}

interface EngineData {
  readonly capability: NativeSelectionCapability;
  readonly options: NativeSelectionEngineOptions;
  readonly listeners: Set<(change: NativeSelectionChange) => void>;
  epoch: number;
  state: NativeSelectionState;
  snapshot: NativeSelectionSnapshot | null;
  session: GestureSession | undefined;
}

export function createNativeSelectionEngine(
  capability: NativeSelectionCapability,
  options: NativeSelectionEngineOptions = {},
): NativeSelectionEngine {
  const data = createData(capability, options);
  return {
    handlePointerDown: (point) => {
      handlePointerDown(data, point);
    },
    handlePointerMove: (point) => {
      queueFocusSample(data, point, false);
    },
    handlePointerUp: (point) => {
      queueFocusSample(data, point, true);
    },
    clear: () => {
      cancelSelection(data, 'idle', true);
    },
    invalidate: () => {
      cancelSelection(data, 'idle', true);
    },
    dispose: () => {
      dispose(data);
    },
    getState: () => data.state,
    getSnapshot: () => data.snapshot,
    onChange: (listener) => subscribe(data, listener),
  };
}

function createData(
  capability: NativeSelectionCapability,
  options: NativeSelectionEngineOptions,
): EngineData {
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

function handlePointerDown(data: EngineData, point: NativeSelectionPoint): void {
  if (data.state === 'disposed') return;
  requireNativeSelectionPoint(point);
  const session: GestureSession = {
    epoch: ++data.epoch,
    anchor: undefined,
    latestSequence: 0,
    queued: undefined,
    moveInFlight: false,
    finalInFlight: false,
    ended: false,
  };
  data.session = session;
  publish(data, 'selecting', null);
  void resolveAnchor(data, session, copyNativeSelectionPoint(point));
}

async function resolveAnchor(
  data: EngineData,
  session: GestureSession,
  point: NativeSelectionPoint,
): Promise<void> {
  try {
    const result = await data.capability.resolveCaret(point);
    if (!isCurrent(data, session)) return;
    if (!result || result.status !== 'resolved') {
      finishEmpty(data, session);
      return;
    }
    session.anchor = result.caret;
    pump(data, session);
  } catch (error: unknown) {
    if (!isCurrent(data, session)) return;
    reportError(data, error);
    finishEmpty(data, session);
  }
}

function queueFocusSample(data: EngineData, point: NativeSelectionPoint, final: boolean): void {
  const session = data.session;
  if (!session || data.state !== 'selecting' || session.ended) return;
  requireNativeSelectionPoint(point);
  const sample: FocusSample = {
    sequence: ++session.latestSequence,
    point: copyNativeSelectionPoint(point),
    final,
  };
  session.queued = sample;
  if (final) session.ended = true;
  pump(data, session);
}

function pump(data: EngineData, session: GestureSession): void {
  const sample = session.queued;
  const anchor = session.anchor;
  if (!isCurrent(data, session) || !sample || !anchor) return;
  if (sample.final ? session.finalInFlight : session.moveInFlight) return;
  session.queued = undefined;
  if (sample.final) session.finalInFlight = true;
  else session.moveInFlight = true;
  void resolveSample(data, session, anchor, sample);
}

async function resolveSample(
  data: EngineData,
  session: GestureSession,
  anchor: ReaderTextCaret,
  sample: FocusSample,
): Promise<void> {
  try {
    const focusResult = await data.capability.resolveCaret(sample.point);
    if (!isLatest(data, session, sample)) return;
    if (!focusResult) {
      finishEmpty(data, session);
      return;
    }
    if (focusResult.status !== 'resolved') {
      handleUnresolvedSample(data, session, sample);
      return;
    }
    const rangeResult = await data.capability.resolveSameFlowRange(anchor, focusResult.caret);
    if (!isLatest(data, session, sample)) return;
    if (!rangeResult) {
      finishEmpty(data, session);
      return;
    }
    if (rangeResult.status !== 'resolved') {
      handleUnresolvedSample(data, session, sample);
      return;
    }
    installRange(data, session, sample, rangeResult.range, focusResult.pageIndex);
  } catch (error: unknown) {
    if (!isLatest(data, session, sample)) return;
    reportError(data, error);
    handleUnresolvedSample(data, session, sample);
  } finally {
    if (sample.final) session.finalInFlight = false;
    else session.moveInFlight = false;
    if (isCurrent(data, session)) pump(data, session);
  }
}

function installRange(
  data: EngineData,
  session: GestureSession,
  sample: FocusSample,
  range: ReaderSameFlowTextRange,
  focusPageIndex: number,
): void {
  if (range.selectedText.length === 0) {
    if (sample.final) finishEmpty(data, session);
    else publish(data, 'selecting', null);
    return;
  }
  const snapshot = toSnapshot(range, focusPageIndex);
  if (sample.final) {
    data.session = undefined;
    publish(data, 'selected', snapshot);
  } else {
    publish(data, 'selecting', snapshot);
  }
}

function handleUnresolvedSample(
  data: EngineData,
  session: GestureSession,
  sample: FocusSample,
): void {
  if (sample.final) finishEmpty(data, session);
}

function finishEmpty(data: EngineData, session: GestureSession): void {
  if (!isCurrent(data, session)) return;
  data.session = undefined;
  publish(data, 'idle', null);
}

function cancelSelection(
  data: EngineData,
  nextState: Extract<NativeSelectionState, 'idle' | 'disposed'>,
  notify: boolean,
): void {
  if (data.state === 'disposed') return;
  data.epoch += 1;
  data.session = undefined;
  if (notify) publish(data, nextState, null);
  else {
    data.state = nextState;
    data.snapshot = null;
  }
}

function dispose(data: EngineData): void {
  if (data.state === 'disposed') return;
  cancelSelection(data, 'disposed', false);
  data.listeners.clear();
}

function isCurrent(data: EngineData, session: GestureSession): boolean {
  return data.state !== 'disposed' && data.session === session && data.epoch === session.epoch;
}

function isLatest(data: EngineData, session: GestureSession, sample: FocusSample): boolean {
  return isCurrent(data, session) && sample.sequence === session.latestSequence;
}

function toSnapshot(
  range: ReaderSameFlowTextRange,
  focusPageIndex: number,
): NativeSelectionSnapshot {
  return {
    range,
    text: range.selectedText,
    rects: range.rects,
    sourceLocator: range.sourceLocator,
    focusDirection: range.focus === range.end ? 'forward' : 'backward',
    focusCaret: { pageIndex: focusPageIndex, geometry: range.focus.geometry },
  };
}

function publish(
  data: EngineData,
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
      reportError(data, error);
    }
  }
}

function subscribe(
  data: EngineData,
  listener: (change: NativeSelectionChange) => void,
): () => void {
  if (data.state === 'disposed') return () => undefined;
  data.listeners.add(listener);
  return () => data.listeners.delete(listener);
}

function reportError(data: EngineData, error: unknown): void {
  try {
    data.options.onError?.(error);
  } catch {
    // Error reporting must not create an unhandled rejection from a void input method.
  }
}
