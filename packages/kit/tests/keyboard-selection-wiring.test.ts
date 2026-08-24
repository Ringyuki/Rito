// @vitest-environment happy-dom

import type { ReaderTextSelectionMovement } from '@ritojs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { wireKeyboardSelection } from '../src/controller/wiring/keyboard-selection';
import type { Emitter, Internals, Nav } from '../src/controller/facade/types';
import { createKeyboardManager, type KeyboardManager } from '../src/keyboard/index';
import type { SelectionEngine } from '../src/interaction/selection/engine';
import {
  registerSelectionInteractionOwner,
  type SelectionGestureOwner,
} from '../src/interaction/selection/selection-interaction-owner';
import { registerSelectionKeyboardOwner } from '../src/interaction/selection/selection-keyboard-owner';
import type {
  NativeSelectionKeyboardCommand,
  NativeSelectionKeyboardOutcome,
} from '../src/interaction/selection/native-types';
import { createDisposableCollection } from '../src/utils/disposable';

const fixtures: WiringFixture[] = [];

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose();
  document.body.replaceChildren();
});

describe('keyboard selection wiring ownership', () => {
  it('starts the first refocused key without waiting for the blurred command', async () => {
    const stale = deferred<NativeSelectionKeyboardOutcome>();
    const fixture = createFixture([stale.promise, Promise.resolve(endBoundary())]);

    fixture.focus();
    fixture.press('ArrowRight');
    expect(fixture.begin).toHaveBeenCalledTimes(1);

    fixture.blur();
    fixture.focus();
    fixture.press('ArrowRight');
    await flushMicrotasks();

    expect(fixture.begin).toHaveBeenCalledTimes(2);
    expect(fixture.begin).toHaveBeenNthCalledWith(2, 'characterRight');
  });

  it('drops queued repeats when a newer content intent supersedes their command', async () => {
    const stale = deferred<NativeSelectionKeyboardOutcome>();
    const fixture = createFixture([stale.promise, Promise.resolve(endBoundary())]);

    fixture.focus();
    fixture.press('ArrowRight');
    fixture.press('ArrowRight');
    expect(fixture.begin).toHaveBeenCalledTimes(1);

    fixture.supersedeContent();
    stale.resolve(endBoundary());
    await flushMicrotasks();

    expect(fixture.begin).toHaveBeenCalledTimes(1);
    expect(fixture.commit).not.toHaveBeenCalled();

    fixture.press('ArrowLeft');
    await flushMicrotasks();
    expect(fixture.begin).toHaveBeenCalledTimes(2);
    expect(fixture.begin).toHaveBeenLastCalledWith('characterLeft');
  });

  it('consumes a focused selection chord even when there is no extendable range', () => {
    const fixture = createFixture([], false);

    fixture.focus();
    const event = fixture.press('ArrowRight');

    expect(event.defaultPrevented).toBe(true);
    expect(fixture.begin).not.toHaveBeenCalled();
    expect(fixture.claimSelectionIntent).not.toHaveBeenCalled();
  });

  it.each([
    ['PageUp', 'pageUp'],
    ['PageDown', 'pageDown'],
  ] as const)('owns Shift+%s before spread navigation and issues %s', async (key, movement) => {
    const fixture = createFixture([Promise.resolve(endBoundary())]);

    fixture.focus();
    const event = fixture.press(key);
    await flushMicrotasks();

    expect(event.defaultPrevented).toBe(true);
    expect(fixture.begin).toHaveBeenCalledWith(movement);
  });

  it('retries a pending movement after an incomplete revision commits a complete final miss', async () => {
    const fixture = createFixture(
      [Promise.resolve(pendingEnd()), Promise.resolve(endBoundary())],
      true,
      true,
    );

    fixture.focus();
    fixture.press('ArrowRight');
    await flushMicrotasks();

    expect(fixture.ensureSelectionSpread).toHaveBeenCalledOnce();
    expect(fixture.begin).toHaveBeenCalledTimes(2);
    expect(fixture.begin).toHaveBeenNthCalledWith(2, 'characterRight');
  });

  it('does not grow pagination for a committed end boundary', async () => {
    const fixture = createFixture([Promise.resolve(endBoundary())]);

    fixture.focus();
    fixture.press('ArrowRight');
    await flushMicrotasks();

    expect(fixture.commit).toHaveBeenCalledOnce();
    expect(fixture.ensureSelectionSpread).not.toHaveBeenCalled();
  });

  it('obeys the shared keyboard manager enabled state and cancels active work', async () => {
    const stale = deferred<NativeSelectionKeyboardOutcome>();
    const fixture = createFixture([stale.promise, Promise.resolve(endBoundary())]);

    fixture.focus();
    fixture.press('ArrowRight');
    fixture.keyboard.setEnabled(false);
    const disabled = fixture.press('ArrowRight');
    expect(disabled.defaultPrevented).toBe(false);

    fixture.keyboard.setEnabled(true);
    const enabled = fixture.press('ArrowLeft');
    await flushMicrotasks();

    expect(enabled.defaultPrevented).toBe(true);
    expect(fixture.begin).toHaveBeenCalledTimes(2);
    expect(fixture.begin).toHaveBeenLastCalledWith('characterLeft');
  });

  it('stops handling selection chords after the shared keyboard manager is disposed', () => {
    const fixture = createFixture([Promise.resolve(endBoundary())]);

    fixture.focus();
    fixture.keyboard.dispose();
    fixture.keyboard.setEnabled(true);
    const event = fixture.press('ArrowRight');

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.begin).not.toHaveBeenCalled();
    expect(fixture.claimSelectionIntent).not.toHaveBeenCalled();
  });
});

interface WiringFixture {
  readonly begin: ReturnType<typeof createKeyboardSelectionHarness>['begin'];
  readonly claimSelectionIntent: ReturnType<typeof vi.fn>;
  readonly commit: ReturnType<typeof createKeyboardSelectionHarness>['commit'];
  readonly ensureSelectionSpread: ReturnType<typeof vi.fn>;
  readonly keyboard: KeyboardManager;
  blur(): void;
  dispose(): void;
  focus(): void;
  press(key: string): KeyboardEvent;
  supersedeContent(): void;
}

function createFixture(
  results: readonly Promise<NativeSelectionKeyboardOutcome>[],
  canExtend = true,
  completeOnFinalMiss = false,
): WiringFixture {
  const selectionHarness = createKeyboardSelectionHarness(results, canExtend);
  const keyboard = createKeyboardManager(document.documentElement);
  const canvas = document.createElement('canvas');
  const otherFocusTarget = document.createElement('button');
  canvas.tabIndex = 0;
  document.body.append(canvas, otherFocusTarget);

  let paginationComplete = false;
  const internals = createInternals(selectionHarness.selection, () => paginationComplete);
  const claimSelectionIntent = vi.fn(() => {
    const generation = ++internals.coordState.contentInteractionGeneration;
    return { owns: () => internals.coordState.contentInteractionGeneration === generation };
  });
  const ensureSelectionSpread = vi.fn(() => {
    if (completeOnFinalMiss) paginationComplete = true;
    return Promise.resolve(false);
  });
  const nav = {
    ensureSelectionSpread,
    jumpToSpreadIfReady: vi.fn(() => 'committed' as const),
    prepareSpreadForJump: vi.fn(() => 'ready' as const),
    supersedeForSelectionIntent: claimSelectionIntent,
  } as unknown as Nav;
  const disposables = createDisposableCollection();
  wireKeyboardSelection(
    internals,
    canvas,
    nav,
    { emit: vi.fn() } as unknown as Emitter,
    keyboard,
    disposables,
  );

  const fixture: WiringFixture = {
    begin: selectionHarness.begin,
    claimSelectionIntent,
    commit: selectionHarness.commit,
    ensureSelectionSpread,
    keyboard,
    blur: () => {
      otherFocusTarget.focus();
    },
    dispose: () => {
      disposables.disposeAll();
      keyboard.dispose();
    },
    focus: () => {
      canvas.focus();
    },
    press: (key) => {
      const event = new KeyboardEvent('keydown', {
        bubbles: true,
        cancelable: true,
        key,
        shiftKey: true,
      });
      canvas.dispatchEvent(event);
      return event;
    },
    supersedeContent: () => {
      internals.coordState.contentInteractionGeneration += 1;
    },
  };
  fixtures.push(fixture);
  return fixture;
}

function createKeyboardSelectionHarness(
  results: readonly Promise<NativeSelectionKeyboardOutcome>[],
  canExtend: boolean,
): {
  readonly selection: SelectionEngine;
  readonly begin: ReturnType<
    typeof vi.fn<(movement: ReaderTextSelectionMovement) => NativeSelectionKeyboardCommand | null>
  >;
  readonly commit: ReturnType<typeof vi.fn<(token: object) => boolean>>;
} {
  let interactionGeneration = 0;
  let activeToken: object | undefined;
  let resultIndex = 0;
  const commit = vi.fn((token: object) => activeToken === token);
  const begin = vi.fn(
    (movement: ReaderTextSelectionMovement): NativeSelectionKeyboardCommand | null => {
      void movement;
      const result = results[resultIndex++];
      if (!result) return null;
      const token = {};
      activeToken = token;
      interactionGeneration += 1;
      return {
        result,
        commit: () => commit(token),
        isActive: () => activeToken === token,
        finish: () => {
          if (activeToken === token) activeToken = undefined;
        },
      };
    },
  );
  const selection = {} as SelectionEngine;
  const gestureOwner: SelectionGestureOwner = {
    capture: () => activeToken ?? null,
    owns: (candidate) => candidate === activeToken,
    supportsProjectionTransfer: true,
  };
  registerSelectionInteractionOwner(selection, () => interactionGeneration, gestureOwner);
  registerSelectionKeyboardOwner(selection, { canExtend: () => canExtend, begin });
  return { selection, begin, commit };
}

function createInternals(selection: SelectionEngine, paginationComplete: () => boolean): Internals {
  return {
    currentSpread: 0,
    reader: {
      spreads: [{ left: { index: 0 }, right: null }],
      totalSpreads: 1,
      pagination: {
        get complete() {
          return paginationComplete();
        },
      },
    },
    engines: { selection },
    coordState: { contentInteractionGeneration: 0 },
  } as unknown as Internals;
}

function endBoundary(): NativeSelectionKeyboardOutcome {
  return { status: 'boundary', boundary: 'end' };
}

function pendingEnd(): NativeSelectionKeyboardOutcome {
  return { status: 'pending', boundary: 'end' };
}

function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      resolvePromise?.(value);
    },
  };
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}
