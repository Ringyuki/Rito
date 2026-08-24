import type { ReaderTextSelectionMovement } from '@ritojs/core';
import { type KeyboardManager } from '../../keyboard/index';
import {
  acceptsKeyboardManagerInput,
  subscribeKeyboardManagerInput,
} from '../../keyboard/input-state';
import {
  captureSelectionGesture,
  ownsSelectionGesture,
  type SelectionGestureLease,
} from '../../interaction/selection/selection-interaction-owner';
import { getSelectionKeyboardOwner } from '../../interaction/selection/selection-keyboard-owner';
import type {
  NativeSelectionKeyboardCommand,
  NativeSelectionKeyboardOutcome,
} from '../../interaction/selection/native-types';
import type { DisposableCollection } from '../../utils/disposable';
import { claimSelectionInputIntent } from '../facade/selection-spread-transfer';
import type { Emitter, Internals, Nav } from '../facade/types';
import { nextKeyboardReadyCheck, settleWithAbort } from './keyboard-selection-async';
import {
  jumpWithKeyboardSelectionIntent,
  ownsKeyboardSelectionIntent,
} from './keyboard-selection-intent';
import { isAppleKeyboardPlatform, keyboardSelectionMovement } from './keyboard-selection-map';
import {
  cancelKeyboardSelectionQueue,
  cancelOwnedKeyboardSelectionQueue,
  createKeyboardSelectionState,
  ownsKeyboardSelectionQueue,
  type KeyboardSelectionState,
} from './keyboard-selection-state';

export { keyboardSelectionMovement } from './keyboard-selection-map';

/** Bind platform selection-extension chords only while the reader surface owns focus. */
export function wireKeyboardSelection(
  internals: Internals,
  canvas: HTMLCanvasElement,
  nav: Nav,
  emitter: Emitter,
  keyboard: KeyboardManager,
  disposables: DisposableCollection,
): void {
  const owner = getSelectionKeyboardOwner(internals.engines.selection);
  if (!owner) return;
  const state = createKeyboardSelectionState(owner);
  const apple = isAppleKeyboardPlatform(navigator);
  const onKeyDown = (event: KeyboardEvent): void => {
    routeKeyboardSelection(event, apple, state, internals, canvas, nav, emitter, keyboard);
  };
  const cancel = (): void => {
    cancelKeyboardSelectionQueue(state);
  };
  const unsubscribeKeyboard = subscribeKeyboardManagerInput(keyboard, (enabled) => {
    if (!enabled) cancel();
  });
  canvas.addEventListener('keydown', onKeyDown);
  canvas.addEventListener('blur', cancel);
  disposables.add(() => {
    state.disposed = true;
    cancel();
    unsubscribeKeyboard();
    canvas.removeEventListener('keydown', onKeyDown);
    canvas.removeEventListener('blur', cancel);
  });
}

function routeKeyboardSelection(
  event: KeyboardEvent,
  apple: boolean,
  state: KeyboardSelectionState,
  internals: Internals,
  canvas: HTMLCanvasElement,
  nav: Nav,
  emitter: Emitter,
  keyboard: KeyboardManager,
): void {
  if (
    state.disposed ||
    !acceptsKeyboardManagerInput(keyboard) ||
    event.target !== canvas ||
    document.activeElement !== canvas
  ) {
    return;
  }
  const movement = keyboardSelectionMovement(event, apple);
  if (!movement) return;
  event.preventDefault();
  event.stopPropagation();
  if (!state.owner.canExtend()) return;
  if (state.intentGeneration !== undefined && !ownsKeyboardSelectionIntent(state, internals)) {
    cancelKeyboardSelectionQueue(state);
  }
  const input = claimSelectionInputIntent(internals, nav);
  if (!input?.owns() || !state.owner.canExtend()) {
    if (!ownsKeyboardSelectionIntent(state, internals)) cancelKeyboardSelectionQueue(state);
    return;
  }
  state.intentGeneration = internals.coordState.contentInteractionGeneration;
  state.movements.push(movement);
  pumpKeyboardSelection(state, internals, nav, emitter);
}

function pumpKeyboardSelection(
  state: KeyboardSelectionState,
  internals: Internals,
  nav: Nav,
  emitter: Emitter,
): void {
  if (state.pumping || state.disposed) return;
  state.pumping = true;
  const generation = state.generation;
  void drainKeyboardSelection(state, internals, nav, emitter, generation).finally(() => {
    state.pumping = false;
    if (state.disposed || state.movements.length === 0) return;
    if (!ownsKeyboardSelectionIntent(state, internals)) {
      cancelKeyboardSelectionQueue(state);
      return;
    }
    pumpKeyboardSelection(state, internals, nav, emitter);
  });
}

async function drainKeyboardSelection(
  state: KeyboardSelectionState,
  internals: Internals,
  nav: Nav,
  emitter: Emitter,
  generation: number,
): Promise<void> {
  while (ownsWork(state, internals, generation)) {
    const movement = state.movements.shift();
    if (!movement) return;
    await runMovement(state, internals, nav, emitter, movement, generation);
  }
}

async function runMovement(
  state: KeyboardSelectionState,
  internals: Internals,
  nav: Nav,
  emitter: Emitter,
  movement: ReaderTextSelectionMovement,
  generation: number,
): Promise<void> {
  while (ownsWork(state, internals, generation)) {
    const command = state.owner.begin(movement);
    if (!command) {
      cancelOwnedKeyboardSelectionQueue(state, generation);
      return;
    }
    state.currentCommand = command;
    const gesture = captureSelectionGesture(internals.engines.selection);
    try {
      if (!gesture) {
        cancelOwnedKeyboardSelectionQueue(state, generation);
        return;
      }
      const outcome = await waitForCommand(state, command);
      if (!outcome) return;
      if (!ownsCommand(state, command, internals, generation, gesture)) {
        cancelOwnedKeyboardSelectionQueue(state, generation);
        return;
      }
      if (outcome.status === 'cancelled' || !command.commit()) {
        cancelOwnedKeyboardSelectionQueue(state, generation);
        return;
      }
      if (outcome.status === 'pending' && outcome.boundary === 'end') {
        if (await growSelectionExtent(state, command, internals, nav, generation)) continue;
        return;
      }
      if (outcome.status !== 'resolved') return;
      await revealFocusPage(state, command, internals, nav, gesture, outcome.range.focus.pageIndex);
      return;
    } catch (error: unknown) {
      reportKeyboardSelectionError(emitter, error);
      cancelOwnedKeyboardSelectionQueue(state, generation);
      return;
    } finally {
      command.finish();
      if (state.currentCommand === command) state.currentCommand = undefined;
    }
  }
}

async function growSelectionExtent(
  state: KeyboardSelectionState,
  command: NativeSelectionKeyboardCommand,
  internals: Internals,
  nav: Nav,
  generation: number,
): Promise<boolean> {
  const abort = new AbortController();
  state.waitAbort = abort;
  const paginationWasIncomplete = internals.reader.pagination?.complete === false;
  try {
    const target = internals.reader.totalSpreads;
    const available = await nav.ensureSelectionSpread(target, abort.signal);
    const completedFinalMiss =
      available === false &&
      paginationWasIncomplete &&
      internals.reader.pagination?.complete === true;
    return (
      (available === true || completedFinalMiss) &&
      ownsWork(state, internals, generation) &&
      command.isActive() &&
      !abort.signal.aborted
    );
  } finally {
    if (state.waitAbort === abort) state.waitAbort = undefined;
  }
}

async function revealFocusPage(
  state: KeyboardSelectionState,
  command: NativeSelectionKeyboardCommand,
  internals: Internals,
  nav: Nav,
  gesture: SelectionGestureLease,
  pageIndex: number,
): Promise<void> {
  const target = spreadIndexForPage(internals, pageIndex);
  if (target === null || target === internals.currentSpread) return;
  const abort = new AbortController();
  state.waitAbort = abort;
  try {
    while (
      command.isActive() &&
      ownsSelectionGesture(gesture) &&
      ownsKeyboardSelectionIntent(state, internals) &&
      !abort.signal.aborted
    ) {
      const readiness = nav.prepareSpreadForJump(target);
      if (readiness === 'superseded') return;
      if (readiness === 'ready') {
        const outcome = jumpWithKeyboardSelectionIntent(state, internals, nav, target, gesture);
        if (outcome === 'committed' || outcome === 'superseded') return;
      }
      await nextKeyboardReadyCheck(abort.signal);
    }
  } finally {
    if (state.waitAbort === abort) state.waitAbort = undefined;
  }
}

function spreadIndexForPage(internals: Internals, pageIndex: number): number | null {
  const index = internals.reader.spreads.findIndex(
    (spread) => spread.left?.index === pageIndex || spread.right?.index === pageIndex,
  );
  return index >= 0 ? index : null;
}

function ownsCommand(
  state: KeyboardSelectionState,
  command: NativeSelectionKeyboardCommand,
  internals: Internals,
  generation: number,
  gesture: SelectionGestureLease,
): boolean {
  return (
    ownsWork(state, internals, generation) && command.isActive() && ownsSelectionGesture(gesture)
  );
}

function ownsWork(
  state: KeyboardSelectionState,
  internals: Internals,
  generation: number,
): boolean {
  return (
    ownsKeyboardSelectionQueue(state, generation) && ownsKeyboardSelectionIntent(state, internals)
  );
}

async function waitForCommand(
  state: KeyboardSelectionState,
  command: NativeSelectionKeyboardCommand,
): Promise<NativeSelectionKeyboardOutcome | undefined> {
  const abort = new AbortController();
  state.waitAbort = abort;
  try {
    return await settleWithAbort(command.result, abort.signal);
  } finally {
    if (state.waitAbort === abort) state.waitAbort = undefined;
  }
}

function reportKeyboardSelectionError(emitter: Emitter, error: unknown): void {
  emitter.emit('error', {
    message: error instanceof Error ? error.message : String(error),
    source: 'native-keyboard-selection',
  });
}
