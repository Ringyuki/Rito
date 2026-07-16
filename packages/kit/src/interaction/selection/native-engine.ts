import type { ReaderTextRange } from '@ritojs/core';
import type {
  NativeSelectionCapability,
  NativeSelectionEngine,
  NativeSelectionEngineOptions,
  NativeSelectionPoint,
} from './native-types';
import { copyNativeSelectionPoint, requireNativeSelectionPoint } from './native-point';
import {
  beginNativeSelectionHandleDrag,
  cancelNativeSelection,
  createNativeSelectionEngineData,
  createNativeSelectionGestureSession,
  disposeNativeSelection,
  finishNativeSelection,
  isCurrentNativeSelection,
  publishNativeSelection,
  reportNativeSelectionError,
  subscribeNativeSelection,
  toNativeSelectionSnapshot,
  type NativeSelectionEngineData,
  type NativeSelectionFocusSample,
  type NativeSelectionGestureSession,
  type NativeSelectionMoveFallback,
} from './native-engine-state';
import {
  finishEmptySelection,
  handleCancelledSample,
  handleUnresolvedSample,
  settleMoveFallback,
} from './native-engine-fallback';

export function createNativeSelectionEngine(
  capability: NativeSelectionCapability,
  options: NativeSelectionEngineOptions = {},
): NativeSelectionEngine {
  const data = createNativeSelectionEngineData(capability, options);
  return {
    beginHandleDrag: (edge) =>
      beginNativeSelectionHandleDrag(data, edge, (session, point, final) => {
        queueHandleFocusSample(data, session, point, final);
      }),
    handlePointerDown: (point, granularity) => {
      handlePointerDown(data, point, granularity);
    },
    handlePointerMove: (point) => {
      queuePointerFocusSample(data, point, false);
    },
    handlePointerUp: (point) => {
      queuePointerFocusSample(data, point, true);
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

function handlePointerDown(
  data: NativeSelectionEngineData,
  point: NativeSelectionPoint,
  granularity: NativeSelectionGestureSession['granularity'] = 'character',
): void {
  if (data.state === 'disposed') return;
  requireNativeSelectionPoint(point);
  const anchorPoint = copyNativeSelectionPoint(point);
  const session = createNativeSelectionGestureSession(
    data,
    granularity,
    granularity === 'character' ? undefined : anchorPoint,
  );
  data.session = session;
  publishNativeSelection(data, 'selecting', null);
  if (granularity === 'character') {
    void resolveAnchor(data, session, anchorPoint);
  } else {
    session.queued = { sequence: 0, point: anchorPoint, final: false };
    pump(data, session);
  }
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
      finishEmptySelection(data, session);
      return;
    }
    session.anchor = result.caret;
    pump(data, session);
  } catch (error: unknown) {
    if (!isCurrentNativeSelection(data, session)) return;
    reportNativeSelectionError(data, error);
    finishEmptySelection(data, session);
  }
}

function queuePointerFocusSample(
  data: NativeSelectionEngineData,
  point: NativeSelectionPoint,
  final: boolean,
): void {
  const session = data.session;
  if (session?.handleDrag) return;
  if (session) queueFocusSample(data, session, point, final);
}

function queueHandleFocusSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  point: NativeSelectionPoint,
  final: boolean,
): void {
  if (!session.handleDrag) return;
  queueFocusSample(data, session, point, final);
}

function queueFocusSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  point: NativeSelectionPoint,
  final: boolean,
): void {
  if (!isCurrentNativeSelection(data, session) || data.state !== 'selecting' || session.ended)
    return;
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
  const ready = session.granularity !== 'character' || session.anchor !== undefined;
  if (!isCurrentNativeSelection(data, session) || !sample || !ready) return;
  if (sample.final ? session.finalInFlight : session.moveInFlight) return;
  session.queued = undefined;
  if (sample.final) session.finalInFlight = true;
  else {
    session.moveInFlight = true;
    session.moveFallback = undefined;
  }
  void resolveSample(data, session, sample);
}

async function resolveSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
): Promise<void> {
  try {
    if (session.granularity === 'character') {
      await resolveCharacterSample(data, session, sample);
    } else {
      await resolveSemanticSample(data, session, sample);
    }
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

async function resolveCharacterSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
): Promise<void> {
  const anchor = session.anchor;
  if (!anchor) return;
  const focusResult = await data.capability.resolveCaret(sample.point);
  if (!isRelevant(data, session, sample)) return;
  if (!focusResult) {
    handleCancelledSample(data, session, sample);
    return;
  }
  if (focusResult.status !== 'resolved') {
    handleUnresolvedSample(data, session, sample);
    return;
  }
  const rangeResult = await data.capability.resolveTextRange(anchor, focusResult.caret);
  if (!isRelevant(data, session, sample)) return;
  if (!rangeResult) {
    handleCancelledSample(data, session, sample);
    return;
  }
  if (rangeResult.status !== 'resolved') {
    handleUnresolvedSample(data, session, sample);
    return;
  }
  installRange(data, session, sample, rangeResult.range);
}

async function resolveSemanticSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
): Promise<void> {
  const anchor = session.anchorPoint;
  const granularity = session.granularity;
  if (!anchor || granularity === 'character') {
    finishEmptySelection(data, session);
    return;
  }
  const rangeResult = await data.capability.resolveTextRangeFromPoints({
    anchor,
    focus: sample.point,
    granularity,
  });
  if (!isRelevant(data, session, sample)) return;
  if (!rangeResult) {
    handleCancelledSample(data, session, sample);
    return;
  }
  if (rangeResult.status !== 'resolved') {
    handleUnresolvedSample(data, session, sample);
    return;
  }
  installRange(data, session, sample, rangeResult.range);
}

function installRange(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
  range: ReaderTextRange,
): void {
  if (!sample.final && session.ended) {
    const fallback: NativeSelectionMoveFallback =
      range.selectedText.length === 0
        ? { status: session.handleDrag ? 'unresolved' : 'collapsed' }
        : { status: 'resolved', snapshot: toNativeSelectionSnapshot(range) };
    settleMoveFallback(data, session, fallback);
    return;
  }
  if (range.selectedText.length === 0) {
    if (sample.final) finishEmptySelection(data, session);
    else if (!session.handleDrag) publishNativeSelection(data, 'selecting', null);
    return;
  }
  const snapshot = toNativeSelectionSnapshot(range);
  if (sample.final) {
    finishNativeSelection(data, session, snapshot);
  } else {
    publishNativeSelection(data, 'selecting', snapshot);
  }
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
