import type { ReaderTextRange, ReaderTextCaret } from '@ritojs/core';
import type {
  NativeSelectionCapability,
  NativeSelectionEngine,
  NativeSelectionEngineOptions,
  NativeSelectionPoint,
  NativeSelectionSnapshot,
} from './native-types';
import { copyNativeSelectionPoint, requireNativeSelectionPoint } from './native-point';
import {
  cancelNativeSelection,
  createNativeSelectionEngineData,
  disposeNativeSelection,
  finishNativeSelection,
  finishWithLastNativeSelection,
  isCurrentNativeSelection,
  publishNativeSelection,
  reportNativeSelectionError,
  subscribeNativeSelection,
  toNativeSelectionSnapshot,
  type NativeSelectionEngineData,
  type NativeSelectionFocusSample,
  type NativeSelectionGestureSession,
} from './native-engine-state';

export function createNativeSelectionEngine(
  capability: NativeSelectionCapability,
  options: NativeSelectionEngineOptions = {},
): NativeSelectionEngine {
  const data = createNativeSelectionEngineData(capability, options);
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
      cancelNativeSelection(data, 'idle', true);
    },
    invalidate: () => {
      cancelNativeSelection(data, 'idle', true);
    },
    dispose: () => {
      disposeNativeSelection(data);
    },
    getState: () => data.state,
    getSnapshot: () => data.snapshot,
    onChange: (listener) => subscribeNativeSelection(data, listener),
  };
}

function handlePointerDown(data: NativeSelectionEngineData, point: NativeSelectionPoint): void {
  if (data.state === 'disposed') return;
  requireNativeSelectionPoint(point);
  const session: NativeSelectionGestureSession = {
    epoch: ++data.epoch,
    anchor: undefined,
    latestSequence: 0,
    queued: undefined,
    moveInFlight: false,
    finalInFlight: false,
    moveFallback: undefined,
    moveFallbackSettled: false,
    finalFallbackRequested: false,
    ended: false,
  };
  data.session = session;
  publishNativeSelection(data, 'selecting', null);
  void resolveAnchor(data, session, copyNativeSelectionPoint(point));
}

async function resolveAnchor(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  point: NativeSelectionPoint,
): Promise<void> {
  try {
    const result = await data.capability.resolveCaret(point);
    if (!isCurrentNativeSelection(data, session)) return;
    if (!result || result.status !== 'resolved') {
      finishEmpty(data, session);
      return;
    }
    session.anchor = result.caret;
    pump(data, session);
  } catch (error: unknown) {
    if (!isCurrentNativeSelection(data, session)) return;
    reportNativeSelectionError(data, error);
    finishEmpty(data, session);
  }
}

function queueFocusSample(
  data: NativeSelectionEngineData,
  point: NativeSelectionPoint,
  final: boolean,
): void {
  const session = data.session;
  if (!session || data.state !== 'selecting' || session.ended) return;
  requireNativeSelectionPoint(point);
  const sample: NativeSelectionFocusSample = {
    sequence: ++session.latestSequence,
    point: copyNativeSelectionPoint(point),
    final,
  };
  session.queued = sample;
  if (final) session.ended = true;
  pump(data, session);
}

function pump(data: NativeSelectionEngineData, session: NativeSelectionGestureSession): void {
  const sample = session.queued;
  const anchor = session.anchor;
  if (!isCurrentNativeSelection(data, session) || !sample || !anchor) return;
  if (sample.final ? session.finalInFlight : session.moveInFlight) return;
  session.queued = undefined;
  if (sample.final) session.finalInFlight = true;
  else {
    session.moveInFlight = true;
    session.moveFallback = undefined;
    session.moveFallbackSettled = false;
  }
  void resolveSample(data, session, anchor, sample);
}

async function resolveSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  anchor: ReaderTextCaret,
  sample: NativeSelectionFocusSample,
): Promise<void> {
  try {
    const focusResult = await data.capability.resolveCaret(sample.point);
    if (!isRelevant(data, session, sample)) return;
    if (!focusResult) {
      finishEmpty(data, session);
      return;
    }
    if (focusResult.status !== 'resolved') {
      handleUnresolvedSample(data, session, sample);
      return;
    }
    const rangeResult = await data.capability.resolveTextRange(anchor, focusResult.caret);
    if (!isRelevant(data, session, sample)) return;
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
    if (!isRelevant(data, session, sample)) return;
    reportNativeSelectionError(data, error);
    handleUnresolvedSample(data, session, sample);
  } finally {
    if (sample.final) session.finalInFlight = false;
    else session.moveInFlight = false;
    if (isCurrentNativeSelection(data, session)) pump(data, session);
  }
}

function installRange(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
  range: ReaderTextRange,
  focusPageIndex: number,
): void {
  if (!sample.final && session.ended) {
    const snapshot =
      range.selectedText.length === 0
        ? undefined
        : toNativeSelectionSnapshot(range, focusPageIndex);
    settleMoveFallback(data, session, snapshot);
    return;
  }
  if (range.selectedText.length === 0) {
    if (sample.final) finishEmpty(data, session);
    else publishNativeSelection(data, 'selecting', null);
    return;
  }
  const snapshot = toNativeSelectionSnapshot(range, focusPageIndex);
  if (sample.final) {
    finishNativeSelection(data, session, snapshot);
  } else {
    publishNativeSelection(data, 'selecting', snapshot);
  }
}

function handleUnresolvedSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
): void {
  if (!sample.final) {
    if (session.ended) settleMoveFallback(data, session, undefined);
    return;
  }
  if (session.moveFallback) {
    finishNativeSelection(data, session, session.moveFallback);
  } else if (session.moveInFlight && !session.moveFallbackSettled) {
    session.finalFallbackRequested = true;
  } else {
    finishWithLastNativeSelection(data, session);
  }
}

function settleMoveFallback(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  snapshot: NativeSelectionSnapshot | undefined,
): void {
  if (!isCurrentNativeSelection(data, session)) return;
  session.moveFallback = snapshot;
  session.moveFallbackSettled = true;
  if (!session.finalFallbackRequested) return;
  if (snapshot) finishNativeSelection(data, session, snapshot);
  else finishWithLastNativeSelection(data, session);
}

function finishEmpty(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
): void {
  finishNativeSelection(data, session, undefined);
}

function isRelevant(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
): boolean {
  if (!isCurrentNativeSelection(data, session)) return false;
  if (sample.sequence === session.latestSequence) return true;
  return !sample.final && session.ended;
}
