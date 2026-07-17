import type { ReaderTextSelectionMovement } from '@ritojs/core';
import type {
  NativeSelectionKeyboardCommand,
  NativeSelectionKeyboardOutcome,
} from './native-types';
import {
  publishNativeSelection,
  reportNativeSelectionError,
  toNativeSelectionSnapshot,
  type NativeSelectionEngineData,
  type NativeSelectionKeyboardSession,
} from './native-engine-state';

interface PreparedKeyboardOutcome {
  readonly outcome: NativeSelectionKeyboardOutcome;
  readonly readGeneration: number;
}

export function canExtendNativeKeyboardSelection(data: NativeSelectionEngineData): boolean {
  return (
    data.state === 'selected' &&
    data.snapshot !== null &&
    data.session === undefined &&
    typeof data.capability.resolveTextSelectionMovement === 'function'
  );
}

export function beginNativeKeyboardMovement(
  data: NativeSelectionEngineData,
  movement: ReaderTextSelectionMovement,
): NativeSelectionKeyboardCommand | null {
  const snapshot = data.snapshot;
  if (!canExtendNativeKeyboardSelection(data) || !snapshot || data.keyboardSession) return null;
  const session: NativeSelectionKeyboardSession = {
    epoch: ++data.epoch,
    readGeneration: 0,
  };
  const preferredInlinePosition = isVerticalLineMovement(movement)
    ? data.keyboardPreferredInlinePosition
    : undefined;
  data.keyboardSession = session;
  return createKeyboardCommand(data, session, movement, preferredInlinePosition);
}

function createKeyboardCommand(
  data: NativeSelectionEngineData,
  session: NativeSelectionKeyboardSession,
  movement: ReaderTextSelectionMovement,
  preferredInlinePosition: number | undefined,
): NativeSelectionKeyboardCommand {
  let prepared: PreparedKeyboardOutcome | undefined;
  let committed = false;
  const result = resolveMovement(data, session, movement, preferredInlinePosition).then(
    (resolved) => {
      prepared = resolved;
      return resolved.outcome;
    },
  );
  return {
    result,
    commit: () => {
      if (
        committed ||
        !prepared ||
        prepared.outcome.status === 'cancelled' ||
        prepared.readGeneration !== session.readGeneration ||
        !isCurrentKeyboardSession(data, session)
      ) {
        return false;
      }
      committed = true;
      commitMovement(data, movement, prepared.outcome);
      return true;
    },
    isActive: () => isCurrentKeyboardSession(data, session),
    finish: () => {
      if (data.keyboardSession === session) data.keyboardSession = undefined;
    },
  };
}

export function isCurrentKeyboardSession(
  data: NativeSelectionEngineData,
  session: NativeSelectionKeyboardSession,
): boolean {
  return (
    data.state !== 'disposed' && data.keyboardSession === session && data.epoch === session.epoch
  );
}

async function resolveMovement(
  data: NativeSelectionEngineData,
  session: NativeSelectionKeyboardSession,
  movement: ReaderTextSelectionMovement,
  preferredInlinePosition: number | undefined,
): Promise<PreparedKeyboardOutcome> {
  const capability = data.capability;
  if (!capability.resolveTextSelectionMovement) return cancelledOutcome(session);
  while (isCurrentKeyboardSession(data, session)) {
    const snapshot = data.snapshot;
    if (!snapshot) return cancelledOutcome(session);
    const readGeneration = session.readGeneration;
    try {
      const result = await capability.resolveTextSelectionMovement({
        anchor: snapshot.range.anchor,
        focus: snapshot.range.focus,
        movement,
        ...(preferredInlinePosition === undefined ? {} : { preferredInlinePosition }),
      });
      if (!isCurrentKeyboardSession(data, session)) return cancelledOutcome(session);
      if (session.readGeneration !== readGeneration) continue;
      return {
        outcome: result ?? { status: 'cancelled' },
        readGeneration,
      };
    } catch (error: unknown) {
      if (!isCurrentKeyboardSession(data, session)) return cancelledOutcome(session);
      if (session.readGeneration !== readGeneration) continue;
      reportNativeSelectionError(data, error);
      return cancelledOutcome(session);
    }
  }
  return cancelledOutcome(session);
}

function cancelledOutcome(session: NativeSelectionKeyboardSession): PreparedKeyboardOutcome {
  return { outcome: { status: 'cancelled' }, readGeneration: session.readGeneration };
}

function commitMovement(
  data: NativeSelectionEngineData,
  movement: ReaderTextSelectionMovement,
  outcome: Exclude<NativeSelectionKeyboardOutcome, { readonly status: 'cancelled' }>,
): void {
  const vertical = isVerticalLineMovement(movement);
  if (!vertical) data.keyboardPreferredInlinePosition = undefined;
  if (outcome.status !== 'resolved') return;
  if (vertical) data.keyboardPreferredInlinePosition = outcome.preferredInlinePosition;
  publishNativeSelection(data, 'selected', toNativeSelectionSnapshot(outcome.range));
}

function isVerticalLineMovement(movement: ReaderTextSelectionMovement): boolean {
  return movement === 'lineUp' || movement === 'lineDown';
}
