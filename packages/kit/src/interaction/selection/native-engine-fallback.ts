import {
  finishNativeSelection,
  finishWithLastNativeSelection,
  isCurrentNativeSelection,
  type NativeSelectionEngineData,
  type NativeSelectionFocusSample,
  type NativeSelectionGestureSession,
  type NativeSelectionMoveFallback,
} from './native-engine-state';

export function handleUnresolvedSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
): void {
  if (!sample.final) {
    if (session.ended) settleMoveFallback(data, session, { status: 'unresolved' });
    else if (session.granularity !== 'character' && sample.sequence === 0) {
      finishEmptySelection(data, session);
    }
    return;
  }
  const fallback = session.moveFallback;
  if (fallback?.status === 'resolved') {
    finishNativeSelection(data, session, fallback.snapshot);
  } else if (session.moveInFlight && !fallback) {
    session.finalFallbackRequested = true;
  } else if (fallback?.status === 'cancelled' || fallback?.status === 'collapsed') {
    finishEmptySelection(data, session);
  } else {
    finishWithLastNativeSelection(data, session);
  }
}

export function handleCancelledSample(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  sample: NativeSelectionFocusSample,
): void {
  if (sample.final) handleUnresolvedSample(data, session, sample);
  else if (session.ended) settleMoveFallback(data, session, { status: 'cancelled' });
  else finishEmptySelection(data, session);
}

export function settleMoveFallback(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  fallback: NativeSelectionMoveFallback,
): void {
  if (!isCurrentNativeSelection(data, session)) return;
  session.moveFallback = fallback;
  if (!session.finalFallbackRequested) return;
  if (fallback.status === 'resolved') {
    finishNativeSelection(data, session, fallback.snapshot);
  } else if (fallback.status === 'cancelled' || fallback.status === 'collapsed') {
    finishEmptySelection(data, session);
  } else {
    finishWithLastNativeSelection(data, session);
  }
}

export function finishEmptySelection(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
): void {
  finishNativeSelection(data, session, undefined);
}
