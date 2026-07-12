import { vi, type Mock } from 'vitest';
import type { Reader, Spread } from '@ritojs/core';
import type { FrameDriver } from '../../src/driver/frame-driver';
import { createTransitionDriver } from '../../src/driver/transition-driver';
import type { PageBufferPool } from '../../src/painter/buffer-pool';
import type { SelectionEngine } from '../../src/interaction/index';
import { createEmitter } from '../../src/utils/event-emitter';
import { createDisposableCollection } from '../../src/utils/disposable';
import { createInteractionModeManager } from '../../src/controller/interaction-mode';
import { createNavigation, type NavigationDeps } from '../../src/controller/navigation';
import { wireSettledEvents } from '../../src/controller/runtime-frame';
import type { ReaderControllerEvents } from '../../src/controller/types';
import type { Internals } from '../../src/controller/facade';
import { wireUnifiedTouchHandler, type GestureDeps } from '../../src/controller/wiring/gesture';
import { createDomTarget, touch, touchEvent } from './dom-input';

interface PoolHarness {
  readonly pool: PageBufferPool;
  readonly slots: { prev: number | null; curr: number | null; next: number | null };
  readonly rotateForward: Mock;
  readonly rotateBackward: Mock;
}

export interface TouchNavigationScenario {
  readonly dom: ReturnType<typeof createDomTarget>;
  readonly td: ReturnType<typeof createTransitionDriver>;
  readonly nav: ReturnType<typeof createNavigation>;
  readonly internals: Internals;
  readonly poolHarness: PoolHarness;
  readonly notifyActiveSpread: Mock;
  readonly transitionEnd: Mock;
  readonly transitionStart: Mock;
  readonly disposables: ReturnType<typeof createDisposableCollection>;
  readonly markContentReady: () => void;
}

export function createTouchNavigationScenario(initialContentReady = true): TouchNavigationScenario {
  const dom = createDomTarget();
  const spreads = [spread(0), spread(1)];
  const notifyActiveSpread = vi.fn();
  const reader = { totalSpreads: 2, spreads, notifyActiveSpread } as unknown as Reader;
  const td = createTransitionDriver();
  td.viewportWidth = 300;
  let contentReady = initialContentReady;
  const poolHarness = createPoolHarness(() => contentReady);
  const frameDriver = { scheduleComposite: vi.fn() } as unknown as FrameDriver;
  const emitter = createEmitter<ReaderControllerEvents>();
  const transitionEnd = vi.fn();
  const transitionStart = vi.fn();
  emitter.on('transitionEnd', transitionEnd);
  emitter.on('transitionStart', transitionStart);
  const internals = { reader, currentSpread: 0 } as unknown as Internals;
  const contentRenderer = vi.fn(() => true);

  wireSettledEvents(internals, td, poolHarness.pool, emitter, frameDriver, reader, contentRenderer);
  const nav = createNavigation({
    getReader: () => reader,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (index) => {
      internals.currentSpread = index;
    },
    getRenderScale: () => 1,
    emitter,
    td,
    frameDriver,
    pool: poolHarness.pool,
    contentRenderer,
  } satisfies NavigationDeps);
  const gestureDeps: GestureDeps = {
    td,
    frameDriver,
    startGestureNavigation: (index, onTransitionStart) => {
      return nav.startGestureNavigation(index, onTransitionStart);
    },
    getCurrentSpread: () => internals.currentSpread,
    getTotalSpreads: () => reader.totalSpreads,
    commitPendingTransition: () => {
      if (td.isAnimating) td.forceSettle();
    },
  };
  const disposables = createDisposableCollection();
  wireUnifiedTouchHandler(
    dom.target,
    gestureDeps,
    selectionStub(),
    createInteractionModeManager('gesture'),
    (value) => ({ x: value.clientX, y: value.clientY }),
    vi.fn(),
    disposables,
  );

  return {
    dom,
    td,
    nav,
    internals,
    poolHarness,
    notifyActiveSpread,
    transitionEnd,
    transitionStart,
    disposables,
    markContentReady(): void {
      contentReady = true;
      nav.notifyContentReady(1);
    },
  };
}

export function beginSwipe(
  scenario: TouchNavigationScenario,
  startX: number,
  movedX: number,
): Touch {
  const start = touch(1, startX, 20);
  const moved = touch(1, movedX, 20);
  scenario.dom.emit('touchstart', touchEvent([start], [start], 0));
  scenario.dom.emit('touchmove', touchEvent([moved], [moved], 10));
  return moved;
}

export function endSwipe(
  scenario: TouchNavigationScenario,
  active: Touch,
  timestamp: number,
): void {
  scenario.dom.emit('touchend', touchEvent([], [active], timestamp));
}

export function cancelSwipe(
  scenario: TouchNavigationScenario,
  active: Touch,
  timestamp: number,
): void {
  scenario.dom.emit('touchcancel', touchEvent([], [active], timestamp));
}

export function settleTransition(td: ReturnType<typeof createTransitionDriver>): void {
  let steps = 0;
  while (td.isAnimating && steps < 500) {
    td.step(16);
    steps += 1;
  }
  if (td.isAnimating) throw new Error('transition did not settle');
}

function createPoolHarness(isContentReady: () => boolean): PoolHarness {
  const slots: { prev: number | null; curr: number | null; next: number | null } = {
    prev: null,
    curr: 0,
    next: null,
  };
  const rotateForward = vi.fn(() => {
    slots.prev = slots.curr;
    slots.curr = slots.next;
    slots.next = null;
  });
  const rotateBackward = vi.fn(() => {
    slots.next = slots.curr;
    slots.curr = slots.prev;
    slots.prev = null;
  });
  const pool = {
    getSlotFor(index: number) {
      if (slots.prev === index) return 'prev';
      if (slots.curr === index) return 'curr';
      if (slots.next === index) return 'next';
      return null;
    },
    assignSlot(position: 'prev' | 'curr' | 'next', index: number) {
      slots[position] = index;
    },
    ensureContent: vi.fn(() => isContentReady()),
    rotateForward,
    rotateBackward,
  } as unknown as PageBufferPool;
  return { pool, slots, rotateForward, rotateBackward };
}

function spread(index: number): Spread {
  return {
    index,
    left: {
      index,
      bounds: { x: 0, y: 0, width: 300, height: 400 },
      content: [],
    },
  };
}

function selectionStub(): SelectionEngine {
  return {
    handlePointerDown: vi.fn(),
    handlePointerMove: vi.fn(),
    handlePointerUp: vi.fn(),
    clear: vi.fn(),
  } as unknown as SelectionEngine;
}
