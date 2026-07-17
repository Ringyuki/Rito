// @vitest-environment happy-dom

import type {
  ReaderTextSelectionInteractions,
  ReaderTextSelectionMovementResolution,
} from '@ritojs/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Emitter, Internals, Nav } from '../src/controller/facade/types';
import { wireKeyboardSelection } from '../src/controller/wiring/keyboard-selection';
import { createKeyboardManager } from '../src/keyboard/index';
import type { SelectionEngine } from '../src/interaction/selection/engine';
import { registerNativeAdapterGestureOwner } from '../src/interaction/selection/native-adapter-gesture';
import { createNativeSelectionEngine } from '../src/interaction/selection/native-engine';
import type { NativeSelectionEngine } from '../src/interaction/selection/native-types';
import { createDisposableCollection } from '../src/utils/disposable';
import {
  caret,
  deferred,
  exactRange,
  flushMicrotasks,
  point,
  resolvedCaret,
} from './helpers/native-selection';

const cleanups: Array<() => void> = [];

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  document.body.replaceChildren();
});

describe('keyboard selection native commit ownership', () => {
  it('does not publish an in-flight native result after a newer content intent', async () => {
    const pending = deferred<ReaderTextSelectionMovementResolution | undefined>();
    const anchor = caret(1);
    const initialFocus = caret(5);
    const movedFocus = caret(8);
    const native = await selectedNativeEngine(anchor, initialFocus, () => pending.promise);
    const baseline = native.getSnapshot();
    const selection = registerNativeAdapterGestureOwner({} as SelectionEngine, native);
    const fixture = wireFixture(selection);

    fixture.canvas.focus();
    const event = pressSelectionKey(fixture.canvas);
    expect(event.defaultPrevented).toBe(true);
    expect(native.captureActiveGesture()).not.toBeNull();

    fixture.internals.coordState.contentInteractionGeneration += 1;
    pending.resolve({
      status: 'resolved',
      range: exactRange(anchor, movedFocus, 'forward', 'stale movement'),
    });
    await flushMicrotasks();

    expect(native.getSnapshot()).toBe(baseline);
    expect(native.getSnapshot()?.range.focus).toBe(initialFocus);
    expect(native.canExtendKeyboardSelection()).toBe(true);
  });
});

interface WiringFixture {
  readonly canvas: HTMLCanvasElement;
  readonly internals: Internals;
}

function wireFixture(selection: SelectionEngine): WiringFixture {
  const canvas = document.createElement('canvas');
  canvas.tabIndex = 0;
  document.body.append(canvas);
  const keyboard = createKeyboardManager(document.documentElement);
  const internals = createInternals(selection);
  const nav = {
    ensureSelectionSpread: vi.fn(() => Promise.resolve(false)),
    jumpToSpreadIfReady: vi.fn(() => 'committed' as const),
    prepareSpreadForJump: vi.fn(() => 'ready' as const),
    supersedeForSelectionIntent: vi.fn(() => {
      const generation = ++internals.coordState.contentInteractionGeneration;
      return { owns: () => internals.coordState.contentInteractionGeneration === generation };
    }),
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
  cleanups.push(() => {
    disposables.disposeAll();
    keyboard.dispose();
  });
  return { canvas, internals };
}

function createInternals(selection: SelectionEngine): Internals {
  return {
    currentSpread: 0,
    reader: {
      spreads: [{ left: { index: 0 }, right: null }],
      totalSpreads: 1,
      pagination: { complete: true },
    },
    engines: { selection },
    coordState: { contentInteractionGeneration: 0 },
  } as unknown as Internals;
}

async function selectedNativeEngine(
  anchor: ReturnType<typeof caret>,
  focus: ReturnType<typeof caret>,
  resolveTextSelectionMovement: NonNullable<
    ReaderTextSelectionInteractions['resolveTextSelectionMovement']
  >,
): Promise<NativeSelectionEngine> {
  const capability: ReaderTextSelectionInteractions = {
    resolveCaret: vi
      .fn<ReaderTextSelectionInteractions['resolveCaret']>()
      .mockResolvedValueOnce(resolvedCaret(anchor)),
    resolveTextRange: vi.fn(),
    resolveTextRangeToPoint: vi.fn().mockResolvedValue({
      status: 'resolved',
      range: exactRange(anchor, focus, 'forward', 'initial'),
    }),
    resolveTextRangeFromPoints: vi.fn(),
    resolveTextSelectionMovement,
  };
  const engine = createNativeSelectionEngine(capability);
  engine.handlePointerDown(point(1));
  await flushMicrotasks();
  engine.handlePointerUp(point(5));
  await flushMicrotasks();
  expect(engine.getState()).toBe('selected');
  cleanups.push(() => {
    engine.dispose();
  });
  return engine;
}

function pressSelectionKey(canvas: HTMLCanvasElement): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: 'ArrowRight',
    shiftKey: true,
  });
  canvas.dispatchEvent(event);
  return event;
}
