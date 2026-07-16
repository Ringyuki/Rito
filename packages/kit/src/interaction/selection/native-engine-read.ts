import {
  isCurrentNativeSelection,
  type NativeSelectionEngineData,
  type NativeSelectionGestureSession,
} from './native-engine-state';

/** Whether an async result still belongs to the active session revision. */
export function isCurrentNativeSelectionRead(
  data: NativeSelectionEngineData,
  session: NativeSelectionGestureSession,
  readGeneration: number,
): boolean {
  return isCurrentNativeSelection(data, session) && session.readGeneration === readGeneration;
}
