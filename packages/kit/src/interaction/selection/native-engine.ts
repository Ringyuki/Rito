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
  isCurrentNativeSelection,
  publishNativeSelection,
  reportNativeSelectionError,
  subscribeNativeSelection,
  type NativeSelectionEngineData,
  type NativeSelectionFocusSample,
  type NativeSelectionGestureSession,
} from './native-engine-state';
import { isCurrentNativeSelectionRead } from './native-engine-read';
import {
  finishEmptySelection,
  handleCancelledSample,
  handleUnresolvedSample,
} from './native-engine-fallback';
import { captureActiveNativeSelectionGesture } from './native-engine-gesture';
import {
  beginNativeKeyboardMovement,
  canExtendNativeKeyboardSelection,
} from './native-engine-keyboard';
import { installNativeSelectionRange } from './native-engine-range';

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
    acceptRevisionAppend: () => {
      acceptRevisionAppend(data);
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
    getInteractionGeneration: () => data.epoch,
    getSnapshot: () => data.snapshot,
    captureActiveGesture: () => captureActiveNativeSelectionGesture(data),
    hasActiveHandleDrag: () => data.session?.handleDrag !== undefined,
    canExtendKeyboardSelection: () => canExtendNativeKeyboardSelection(data),
    beginKeyboardMovement: (movement) => beginNativeKeyboardMovement(data, movement),
    onChange: (listener) => subscribeNativeSelection(data, listener),
  };
}

function handlePointerDown(
  data: NativeSelectionEngineData,
  point: NativeSelectionPoint,
  granularity: NativeSelectionGestureSession['granularity'] = 'character',
): void {
  if (data.state === 'disposed') return;
  data.keyboardSession = undefined;
  data.keyboardPreferredInlinePosition = undefined;
  data.keyboardPreferredBlockPosition = undefined;
  requireNativeSelectionPoint(point);
  const anchorPoint = copyNativeSelectionPoint(point);
  const session = createNativeSelectionGestureSession(data, granularity, anchorPoint);
  data.session = session;
  publishNativeSelection(data, 'selecting', null);
  if (granularity === 'character') {
    void resolveAnchor(data, session, anchorPoint);
  } else {
    const sample = { sequence: 0, point: anchorPoint, final: false };
    session.latestSample = sample;
    session.queued = sample;
    pump(data, session);
  }
}

async function resolveAnchor(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  point: NativeSelectionPoint,
): Promise<void> {
  const readGeneration = session.readGeneration;
  try {
    const result = await data.capability.resolveCaret(point);
    if (!isCurrentNativeSelectionRead(data, session, readGeneration)) return;
    if (!result || result.status !== 'resolved') {
      finishEmptySelection(data, session);
      return;
    }
    session.anchor = result.caret;
    pump(data, session);
  } catch (error: unknown) {
    if (!isCurrentNativeSelectionRead(data, session, readGeneration)) return;
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
  session.latestSample = sample;
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
  void resolveSample(data, session, sample, session.readGeneration);
}

async function resolveSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
  readGeneration: number,
): Promise<void> {
  try {
    if (session.granularity === 'character') {
      await resolveCharacterSample(data, session, sample, readGeneration);
    } else {
      await resolveSemanticSample(data, session, sample, readGeneration);
    }
  } catch (error: unknown) {
    if (!isRelevant(data, session, sample, readGeneration)) return;
    reportNativeSelectionError(data, error);
    handleUnresolvedSample(data, session, sample);
  } finally {
    if (isCurrentNativeSelectionRead(data, session, readGeneration)) {
      if (sample.final) session.finalInFlight = false;
      else session.moveInFlight = false;
      pump(data, session);
    }
  }
}

async function resolveCharacterSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
  readGeneration: number,
): Promise<void> {
  const anchor = session.anchor;
  if (!anchor) return;
  const rangeResult = await data.capability.resolveTextRangeToPoint(anchor, sample.point);
  if (!isRelevant(data, session, sample, readGeneration)) return;
  if (!rangeResult) {
    handleCancelledSample(data, session, sample);
    return;
  }
  if (rangeResult.status !== 'resolved') {
    handleUnresolvedSample(data, session, sample);
    return;
  }
  session.anchor = rangeResult.range.anchor;
  installNativeSelectionRange(data, session, sample, rangeResult.range);
}

async function resolveSemanticSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
  readGeneration: number,
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
  if (!isRelevant(data, session, sample, readGeneration)) return;
  if (!rangeResult) {
    handleCancelledSample(data, session, sample);
    return;
  }
  if (rangeResult.status !== 'resolved') {
    handleUnresolvedSample(data, session, sample);
    return;
  }
  installNativeSelectionRange(data, session, sample, rangeResult.range);
}

function isRelevant(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
  readGeneration: number,
): boolean {
  if (!isCurrentNativeSelectionRead(data, session, readGeneration)) return false;
  if (sample.sequence === session.latestSequence) return true;
  return !sample.final && session.ended;
}

function acceptRevisionAppend(data: NativeSelectionEngineData): void {
  if (data.keyboardSession) data.keyboardSession.readGeneration += 1;
  const session = data.session;
  if (!session || data.state !== 'selecting') return;
  session.readGeneration += 1;
  session.queued = session.latestSample;
  session.moveInFlight = false;
  session.finalInFlight = false;
  session.moveFallback = undefined;
  session.finalFallbackRequested = false;
  if (session.granularity !== 'character' || session.anchor) {
    pump(data, session);
    return;
  }
  if (session.anchorPoint) void resolveAnchor(data, session, session.anchorPoint);
}
