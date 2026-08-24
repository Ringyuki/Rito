import type { SelectionEngine } from './engine';
import type { NativeSelectionEngine, NativeSelectionGestureLease } from './native-types';
import {
  consumeSelectionGestureProjection,
  registerSelectionInteractionOwner,
} from './selection-interaction-owner';
import { registerSelectionKeyboardOwner } from './selection-keyboard-owner';

/** Register native gesture ownership without widening the public SelectionEngine facade. */
export function registerNativeAdapterGestureOwner(
  owner: SelectionEngine,
  native: NativeSelectionEngine,
): SelectionEngine {
  const registered = registerSelectionInteractionOwner(
    owner,
    () => native.getInteractionGeneration(),
    {
      capture: () => native.captureActiveGesture(),
      owns: (token) => isNativeSelectionGestureLease(token) && token.isActive(),
      supportsProjectionTransfer: true,
    },
  );
  registerSelectionKeyboardOwner(registered, {
    canExtend: () => native.canExtendKeyboardSelection(),
    begin: (movement) => native.beginKeyboardMovement(movement),
  });
  return registered;
}

/** Consume a one-shot gesture transfer while retaining the legacy handle-only opt-in. */
export function shouldPreserveNativeAdapterGesture(
  owner: SelectionEngine | undefined,
  native: NativeSelectionEngine,
  preserveNativeHandleDrag: boolean,
): boolean {
  const authorizedGesture = owner ? consumeSelectionGestureProjection(owner) : false;
  return (
    (authorizedGesture && native.captureActiveGesture() !== null) ||
    ((authorizedGesture || preserveNativeHandleDrag) && native.hasActiveHandleDrag())
  );
}

function isNativeSelectionGestureLease(token: object): token is NativeSelectionGestureLease {
  return typeof (token as { isActive?: unknown }).isActive === 'function';
}
