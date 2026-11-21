import { vi, type Mock } from 'vitest';
import type { TurnDirection } from '@ritojs/core';
import type { TransitionDriver } from '../../src/driver/transition-driver';
import type { TurnTargets } from '../../src/controller/wiring/turns';

export interface FakeTurns {
  /** The turns as navigation sees them: commanded, settled at once, interrupted. */
  readonly td: TransitionDriver;
  readonly turnTargets: TurnTargets;
  /** Each turn taken: which way, from which spread, to which. */
  readonly commands: (readonly [TurnDirection, number, number])[];
  /** The driver's `command`, to make it fail. */
  readonly command: Mock<(direction: TurnDirection) => boolean>;
  readonly settleNow: Mock<() => void>;
  readonly interrupt: Mock<() => void>;
  /** Whether a turn is on screen (navigation reads it before settling one). */
  animating: boolean;
}

/**
 * The engine's turns for navigation tests: a command is taken unless
 * `refuse` says otherwise, and lands at once on the spread it brings in
 * (`land`), as a turn whose page is painted does.
 */
export function fakeTurns(
  current: () => number,
  land: (spread: number) => void,
  refuse: (direction: TurnDirection) => boolean = () => false,
): FakeTurns {
  let aimed: { direction: TurnDirection; spread: number } | null = null;
  const turnTargets: TurnTargets = {
    of: (direction) =>
      aimed?.direction === direction ? aimed.spread : current() + (direction === 'next' ? 1 : -1),
    aim: (direction, spread) => {
      aimed = { direction, spread };
    },
    forget: () => {
      aimed = null;
    },
  };
  const command = vi.fn((direction: TurnDirection) => {
    if (refuse(direction)) return false;
    const from = current();
    const to = turnTargets.of(direction);
    state.commands.push([direction, from, to]);
    state.animating = true;
    land(to);
    turnTargets.forget();
    return true;
  });
  const state: FakeTurns = {
    td: undefined as unknown as TransitionDriver,
    turnTargets,
    commands: [],
    command,
    settleNow: vi.fn(() => {
      state.animating = false;
    }),
    interrupt: vi.fn(() => {
      state.animating = false;
    }),
    animating: false,
  };
  const td = {
    get isAnimating() {
      return state.animating;
    },
    get turning() {
      return state.animating;
    },
    viewportWidth: 800,
    command,
    settleNow: state.settleNow,
    interrupt: state.interrupt,
  };
  (state as { td: TransitionDriver }).td = td as unknown as TransitionDriver;
  return state;
}
