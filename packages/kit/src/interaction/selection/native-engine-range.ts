import type { ReaderTextRange } from '@ritojs/core';
import { finishEmptySelection, settleMoveFallback } from './native-engine-fallback';
import {
  finishNativeSelection,
  publishNativeSelection,
  toNativeSelectionSnapshot,
  type NativeSelectionEngineData,
  type NativeSelectionFocusSample,
  type NativeSelectionGestureSession,
  type NativeSelectionMoveFallback,
} from './native-engine-state';

export function installNativeSelectionRange(
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
  if (sample.final) finishNativeSelection(data, session, snapshot);
  else publishNativeSelection(data, 'selecting', snapshot);
}
