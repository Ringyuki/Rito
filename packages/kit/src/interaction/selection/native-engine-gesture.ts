import type { NativeSelectionGestureLease } from './native-types';
import { isCurrentNativeSelection, type NativeSelectionEngineData } from './native-engine-state';

/** Capture one exact, unfinished gesture session for a synchronous projection transfer. */
export function captureActiveNativeSelectionGesture(
  data: NativeSelectionEngineData,
): NativeSelectionGestureLease | null {
  const session = data.session;
  if (!session || data.state !== 'selecting' || session.ended) return null;
  return {
    isActive: () =>
      isCurrentNativeSelection(data, session) && data.state === 'selecting' && !session.ended,
  };
}
