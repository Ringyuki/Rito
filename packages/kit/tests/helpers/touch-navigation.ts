import { vi, type Mock } from 'vitest';
import type { Reader, Spread } from '@ritojs/core';
import type { FrameDriver } from '../../src/driver/frame-driver';
import { createTransitionDriver } from '../../src/driver/transition-driver';
import type { SelectionEngine } from '../../src/interaction/index';
import { createEmitter } from '../../src/utils/event-emitter';
import { createDisposableCollection } from '../../src/utils/disposable';
import { createInteractionModeManager } from '../../src/controller/interaction-mode';
import { createNavigation, type NavigationDeps } from '../../src/controller/navigation';
import { createPrerenderScheduler } from '../../src/controller/prerender';
import { wireTurns } from '../../src/controller/wiring/turns';
import type { ReaderControllerEvents } from '../../src/controller/types';
import type { Internals } from '../../src/controller/facade';
import { wireUnifiedTouchHandler, type GestureDeps } from '../../src/controller/wiring/gesture';
import { createDomTarget, touch, touchEvent } from './dom-input';
import { createPoolHarness, type PoolHarness } from './real-turns';

export interface TouchNavigationScenario {
  readonly dom: ReturnType<typeof createDomTarget>;
  readonly td: ReturnType<typeof createTransitionDriver>;
  readonly nav: ReturnType<typeof createNavigation>;
  readonly internals: Internals;
  readonly poolHarness: PoolHarness;
  readonly notifyActiveSpread: Mock;
  readonly spreadChange: Mock;
  readonly transitionEnd: Mock;
  readonly transitionStart: Mock;
  readonly disposables: ReturnType<typeof createDisposableCollection>;
  /** The page of a spread is painted: of spread 1 unless another is named. */
  readonly markContentReady: (index?: number) => void;
  /** The page of a spread is not painted yet: a turn to it waits. */
  readonly holdContent: (index: number) => void;
}

export function createTouchNavigationScenario(
  initialContentReady = true,
  spreadCount = 2,
): TouchNavigationScenario {
  const dom = createDomTarget();
  const spreads = Array.from({ length: spreadCount }, (_, index) => spread(index));
  const notifyActiveSpread = vi.fn();
  const reader = { totalSpreads: spreadCount, spreads, notifyActiveSpread } as unknown as Reader;
  const td = createTransitionDriver();
  td.viewportWidth = 300;
  let contentReady = initialContentReady;
  const held = new Set<number>();
  const poolHarness = createPoolHarness((index) => contentReady && !held.has(index ?? -1));
  const frameDriver = { scheduleComposite: vi.fn() } as unknown as FrameDriver;
  const emitter = createEmitter<ReaderControllerEvents>();
  const spreadChange = vi.fn();
  const transitionEnd = vi.fn();
  const transitionStart = vi.fn();
  emitter.on('spreadChange', spreadChange);
  emitter.on('transitionEnd', transitionEnd);
  emitter.on('transitionStart', transitionStart);
  const internals = { reader, currentSpread: 0 } as unknown as Internals;
  const contentRenderer = vi.fn(() => true);
  const disposables = createDisposableCollection();
  const prerenderScheduler = createPrerenderScheduler();

  const turns = wireTurns({
    internals,
    td,
    pool: poolHarness.pool,
    emitter,
    frameDriver,
    reader,
    contentRenderer,
    prerenderScheduler,
  });
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
    turnTargets: turns.targets,
  } satisfies NavigationDeps);
  const gestureDeps: GestureDeps = {
    td,
    frameDriver,
    claimForFinger: () => {
      nav.supersedeForGesture();
    },
  };
  wireUnifiedTouchHandler(
    dom.target,
    gestureDeps,
    selectionStub(),
    createInteractionModeManager('gesture'),
    (value) => ({ x: value.clientX, y: value.clientY }),
    vi.fn(),
    disposables,
  );
  disposables.add(turns.dispose);
  disposables.add(() => {
    nav.dispose();
  });
  disposables.add(() => {
    prerenderScheduler.dispose();
  });

  return {
    dom,
    td,
    nav,
    internals,
    poolHarness,
    notifyActiveSpread,
    spreadChange,
    transitionEnd,
    transitionStart,
    disposables,
    markContentReady(index = 1): void {
      contentReady = true;
      held.delete(index);
      nav.notifyContentReady(index);
    },
    holdContent(index): void {
      held.add(index);
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

function spread(index: number): Spread {
  return { index, pageIndexes: [index], leftPageIndex: index };
}

function selectionStub(): SelectionEngine {
  return {
    handlePointerDown: vi.fn(),
    handlePointerMove: vi.fn(),
    handlePointerUp: vi.fn(),
    clear: vi.fn(),
  } as unknown as SelectionEngine;
}
