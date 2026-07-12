import type { ReadingPosition } from '../../interaction/index';
import { getPositionIntentSupersessionSignal } from '../../interaction/position/intent';
import type { Internals, Nav, PositionActionsSlice } from './types';

export function buildPositionActions(internals: Internals, nav: Nav): PositionActionsSlice {
  let latestRestoreId = 0;
  return {
    restorePosition: () => {
      const restoreId = ++latestRestoreId;
      return trackPositionAction(
        internals,
        restorePosition(internals, nav, () => restoreId === latestRestoreId),
      );
    },
    savePosition: () => savePosition(internals),
    goToPosition: (position) =>
      trackPositionAction(internals, goToPosition(position, internals, nav)),
  };
}

async function restorePosition(
  internals: Internals,
  nav: Nav,
  isLatestRestore: () => boolean,
): Promise<number | undefined> {
  const tracker = internals.engines.position;
  const intent = tracker?.claimPortableIntent();
  let failed = false;
  try {
    if (!tracker || !intent) return undefined;
    nav.supersedeForPositionIntent();
    if (!tracker.owns(intent)) return undefined;
    const loadAttempt = await racePositionIntentOperation(
      Promise.resolve(internals.options.positionStorage?.load()),
      getPositionIntentSupersessionSignal(intent),
    );
    if (loadAttempt.kind === 'superseded') return undefined;
    const serialized = loadAttempt.value ?? null;
    if (!tracker.owns(intent)) return undefined;
    if (!serialized) {
      if (tracker.cancelPortableIntent(intent)) tracker.update(internals.currentSpread);
      return undefined;
    }
    const idx = await tracker.restore(serialized, intent);
    if (idx !== undefined && !tracker.owns(intent)) return undefined;
    if (idx === undefined) {
      recoverPortableIntent(internals, intent);
    } else if (idx !== internals.currentSpread) {
      if (!jumpToPositionSpread(internals, nav, tracker, intent, idx)) return undefined;
    }
    return idx;
  } catch (error) {
    if (!tracker || !intent || !tracker.owns(intent)) return undefined;
    failed = true;
    recoverPortableIntent(internals, intent);
    throw error;
  } finally {
    if (isLatestRestore()) {
      internals.restoreCompleted = true;
      if (failed) await persistCurrentPosition(internals).catch(ignoreResult);
      else await persistCurrentPosition(internals);
    }
  }
}

async function savePosition(internals: Internals): Promise<void> {
  const tracker = internals.engines.position;
  if (!tracker) return;
  await settlePositionAction(internals);
  await tracker.settle();
  const serialized = tracker.serialize();
  if (serialized !== undefined) await internals.positionPersistence.save(serialized);
}

function trackPositionAction<T>(internals: Internals, action: Promise<T>): Promise<T> {
  internals.pendingPositionAction = action;
  const clear = (): void => {
    if (internals.pendingPositionAction === action) internals.pendingPositionAction = undefined;
  };
  void action.then(clear, clear);
  return action;
}

async function settlePositionAction(internals: Internals): Promise<void> {
  while (internals.pendingPositionAction) {
    await internals.pendingPositionAction.catch(ignoreResult);
  }
}

async function goToPosition(
  position: ReadingPosition,
  internals: Internals,
  nav: Nav,
): Promise<number | undefined> {
  const tracker = internals.engines.position;
  if (!tracker) return undefined;
  const intent = tracker.claimPortableIntent();
  let resolved: Awaited<ReturnType<typeof tracker.resolveForNavigation>>;
  try {
    nav.supersedeForPositionIntent();
    if (!tracker.owns(intent)) return undefined;
    resolved = await tracker.resolveForNavigation(position, intent);
  } catch (error) {
    recoverPortableIntent(internals, intent);
    throw error;
  }
  if (!resolved) {
    recoverPortableIntent(internals, intent);
    return undefined;
  }
  const projected = resolved.position;
  const idx = projected.projection.spreadIndex;
  if (!tracker.commit(intent, projected)) return undefined;
  if (idx === internals.currentSpread) return idx;
  if (!jumpToPositionSpread(internals, nav, tracker, intent, idx)) return undefined;
  return idx;
}

function jumpToPositionSpread(
  internals: Internals,
  nav: Nav,
  tracker: NonNullable<Internals['engines']['position']>,
  intent: { readonly generation: number },
  spreadIndex: number,
): boolean {
  const mode = { kind: 'skip', spreadIndex, intent } as const;
  internals.coordState.positionUpdateMode = mode;
  const completed = nav.jumpToSpread(spreadIndex, true) && tracker.owns(intent);
  if (!completed && internals.coordState.positionUpdateMode === mode) {
    internals.coordState.positionUpdateMode = { kind: 'capture' };
  }
  return completed;
}

type PositionIntentAttempt<T> =
  | { readonly kind: 'value'; readonly value: T }
  | { readonly kind: 'superseded' };

function racePositionIntentOperation<T>(
  operation: Promise<T>,
  signal: AbortSignal | undefined,
): Promise<PositionIntentAttempt<T>> {
  const value = operation.then(
    (result): PositionIntentAttempt<T> => ({
      kind: 'value',
      value: result,
    }),
  );
  if (!signal) return value;
  let onSuperseded!: () => void;
  const superseded = new Promise<PositionIntentAttempt<T>>((resolve) => {
    onSuperseded = () => {
      resolve({ kind: 'superseded' });
    };
    signal.addEventListener('abort', onSuperseded, { once: true });
    if (signal.aborted) onSuperseded();
  });
  return Promise.race([value, superseded]).finally(() => {
    signal.removeEventListener('abort', onSuperseded);
  });
}

function recoverPortableIntent(
  internals: Internals,
  intent: { readonly generation: number },
): void {
  const tracker = internals.engines.position;
  if (tracker?.cancelPortableIntent(intent)) tracker.update(internals.currentSpread);
}

async function persistCurrentPosition(internals: Internals): Promise<void> {
  const serialized = internals.engines.position?.serialize();
  if (serialized !== undefined) await internals.positionPersistence.save(serialized);
}

function ignoreResult(): void {}
