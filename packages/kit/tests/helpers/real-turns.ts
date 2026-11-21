import { vi, type Mock } from 'vitest';
import type { Reader } from '@ritojs/core';
import type { FrameDriver } from '../../src/driver/frame-driver';
import { createTransitionDriver, type TransitionDriver } from '../../src/driver/transition-driver';
import type { PageBufferPool } from '../../src/painter/buffer-pool';
import type { Internals } from '../../src/controller/facade';
import type { Emitter } from '../../src/controller/facade/types';
import { createPrerenderScheduler } from '../../src/controller/prerender';
import { wireTurns, type TurnTargets } from '../../src/controller/wiring/turns';

export interface PoolHarness {
  readonly pool: PageBufferPool;
  readonly slots: { prev: number | null; curr: number | null; next: number | null };
  readonly rotateForward: Mock;
  readonly rotateBackward: Mock;
}

/** Three slots, the spread in each painted when `isPainted` says so. */
export function createPoolHarness(isPainted: (index: number | null) => boolean): PoolHarness {
  const slots: PoolHarness['slots'] = { prev: null, curr: 0, next: null };
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
  const slot = (position: 'prev' | 'curr' | 'next') => ({
    spreadIndex: slots[position],
    contentDirty: !isPainted(slots[position]),
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
    ensureContent: vi.fn((position: 'prev' | 'curr' | 'next') => isPainted(slots[position])),
    get prev() {
      return slot('prev');
    },
    get curr() {
      return slot('curr');
    },
    get next() {
      return slot('next');
    },
    rotateForward,
    rotateBackward,
    jump: vi.fn((spreadIndex: number) => {
      slots.prev = null;
      slots.curr = spreadIndex;
      slots.next = null;
    }),
  } as unknown as PageBufferPool;
  return { pool, slots, rotateForward, rotateBackward };
}

export interface RealTurns {
  readonly td: TransitionDriver;
  readonly turnTargets: TurnTargets;
  readonly frameDriver: FrameDriver;
  readonly dispose: () => void;
}

/**
 * The engine's turns, carried out by the kit's own turn wiring over `pool`:
 * a turn lands the reader (`internals.currentSpread`) when it is decided.
 */
export function createRealTurns(deps: {
  readonly internals: Internals;
  readonly reader: Reader;
  readonly pool: PageBufferPool;
  readonly emitter: Emitter;
}): RealTurns {
  const td = createTransitionDriver();
  td.viewportWidth = 300;
  const frameDriver = {
    scheduleComposite: vi.fn(),
    warmTransition: vi.fn(),
  } as unknown as FrameDriver;
  const prerenderScheduler = createPrerenderScheduler();
  const turns = wireTurns({
    ...deps,
    td,
    frameDriver,
    contentRenderer: vi.fn(() => true),
    prerenderScheduler,
  });
  return {
    td,
    turnTargets: turns.targets,
    frameDriver,
    dispose: () => {
      turns.dispose();
      prerenderScheduler.dispose();
    },
  };
}
