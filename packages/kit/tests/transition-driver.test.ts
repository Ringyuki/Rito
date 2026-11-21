import { describe, expect, it } from 'vitest';
import type { TurnAction, TurnPages } from '@ritojs/core';
import { createTransitionDriver, type TransitionDriver } from '../src/driver/transition-driver';
import type { TransitionDriverOptions } from '../src/driver/types';

// The rules of a turn (when a release lands, how a turn cut into carries
// on, what a key does to a turn on screen) are the engine's, held to its
// own spec. These say the kit's driver tells the engine what happens, with
// what the host knows of the pages, and hands back what it decides.

interface Sides {
  next: boolean;
  previous: boolean;
}

interface Host {
  readonly td: TransitionDriver;
  readonly actions: string[];
  /** Which neighbours exist, and which are painted in their slots. */
  readonly pages: { can: Sides; there: Sides };
  /** Whether the host lands a turn when asked. */
  landing: boolean;
}

function describeAction(action: TurnAction): string {
  switch (action.kind) {
    case 'started':
    case 'land':
    case 'fetch':
      return `${action.kind}:${action.direction}`;
    case 'ended':
      return `ended:${action.direction}:${action.outcome}`;
    case 'wait-for-effect':
    case 'rested':
      return action.kind;
  }
}

function host(options?: Partial<TransitionDriverOptions>): Host {
  const td = createTransitionDriver(options);
  td.viewportWidth = 800;
  const pages = {
    can: { next: true, previous: true },
    there: { next: true, previous: true },
  };
  const state: Host = { td, actions: [], pages, landing: true };
  td.pagesFrom(
    (): TurnPages => ({
      canTurn: { ...pages.can },
      there: { ...pages.there },
      drawable: { next: true, previous: true },
      beyond: { ...pages.can },
    }),
  );
  td.onAction((action) => {
    state.actions.push(describeAction(action));
    if (action.kind === 'land') td.landed(state.landing);
  });
  return state;
}

function settle(td: TransitionDriver): void {
  for (let frame = 0; td.isAnimating && frame < 500; frame += 1) td.step(16);
  if (td.isAnimating) throw new Error('the turn did not come to rest');
}

const at = (x: number) => ({ x, y: 20 });

function drag(td: TransitionDriver, travels: readonly number[], every = 16): number {
  td.fingerDown(at(400), 0);
  let time = 0;
  for (const travel of travels) {
    time += every;
    td.fingerMove(at(400 + travel), travel, time);
  }
  return time;
}

describe('the driver at rest', () => {
  it('is idle and draws the page shown', () => {
    const { td } = host();
    expect(td.mode).toEqual({ kind: 'idle' });
    expect(td.isAnimating).toBe(false);
    expect(td.turning).toBe(false);
    expect(td.step(16)).toEqual({ kind: 'single', slot: 'curr' });
  });

  it('is told nothing to interrupt or settle before its first turn', () => {
    const { td, actions } = host();
    td.interrupt();
    td.settleNow();
    expect(actions).toEqual([]);
  });
});

describe('a turn commanded', () => {
  it('begins, lands at once and ends when it has moved the page', () => {
    const { td, actions } = host();
    expect(td.command('next')).toBe(true);
    expect(actions).toEqual(['started:next', 'land:next']);
    expect(td.turning).toBe(true);
    const frame = td.step(16);
    expect(frame).toMatchObject({ kind: 'turning', outgoing: 'curr', incoming: 'next' });
    expect(frame.kind === 'turning' && frame.dx < 0).toBe(true);
    settle(td);
    expect(actions).toEqual(['started:next', 'land:next', 'ended:next:committed']);
    expect(td.mode).toEqual({ kind: 'idle' });
  });

  it('turns back toward the page before, its picture moving the other way', () => {
    const { td, actions } = host();
    td.command('previous');
    const frame = td.step(16);
    expect(frame).toMatchObject({ kind: 'turning', incoming: 'prev' });
    expect(frame.kind === 'turning' && frame.dx > 0).toBe(true);
    settle(td);
    expect(actions.at(-1)).toBe('ended:previous:committed');
  });

  it('is not taken at the end of the book', () => {
    const { td, actions, pages } = host();
    pages.can.next = false;
    expect(td.command('next')).toBe(false);
    expect(actions).toEqual([]);
  });

  it('asks for its page and begins once the host says it is painted', () => {
    const { td, actions, pages } = host();
    pages.there.next = false;
    expect(td.command('next')).toBe(true);
    expect(actions).toEqual(['fetch:next']);
    expect(td.turning).toBe(false);
    pages.there.next = true;
    td.pagesChanged();
    expect(actions).toEqual(['fetch:next', 'started:next', 'land:next']);
  });

  it('goes back when the host cannot land it', () => {
    const state = host();
    state.landing = false;
    state.td.command('next');
    settle(state.td);
    expect(state.actions).toEqual(['started:next', 'land:next', 'ended:next:cancelled']);
  });

  it('lands on its first frame when the effect turns pages at once', () => {
    const { td, actions } = host({ effect: 'none' });
    td.command('next');
    td.step(16);
    expect(td.isAnimating).toBe(false);
    expect(actions.at(-1)).toBe('ended:next:committed');
  });
});

describe('a finger turning the page', () => {
  it('moves the page as far as it carries it, the neighbour coming in', () => {
    const { td, actions } = host();
    drag(td, [-40, -120, -200]);
    expect(actions).toEqual(['started:next']);
    expect(td.mode).toMatchObject({ kind: 'tracking', direction: 'forward', hasIncoming: true });
    expect(td.step(16)).toMatchObject({ kind: 'turning', incoming: 'next', dx: -200 });
  });

  it('lands a release past the threshold, and sends a short slow one back', () => {
    const far = host({ swipeThreshold: 50 });
    const time = drag(far.td, [-30, -60, -100], 100);
    far.td.fingerUp(at(300), -100, time + 100);
    expect(far.actions).toEqual(['started:next', 'land:next']);
    settle(far.td);
    expect(far.actions.at(-1)).toBe('ended:next:committed');

    // Slow enough that the step the finger made crossing the slop has left
    // the samples its speed is measured from.
    const near = host({ swipeThreshold: 50 });
    const slow = drag(near.td, [-2, -4, -6, -8, -10, -10], 100);
    near.td.fingerUp(at(390), -10, slow + 100);
    settle(near.td);
    expect(near.actions).toEqual(['started:next', 'ended:next:cancelled']);
  });

  it('lands a flick shorter than the threshold', () => {
    const { td, actions } = host({ swipeThreshold: 100, velocityCommit: 0.4 });
    const time = drag(td, [-5, -15, -30, -50, -80], 10);
    td.fingerUp(at(320), -80, time + 10);
    expect(actions).toEqual(['started:next', 'land:next']);
  });

  it('sends the page back when the finger is taken away, however far it went', () => {
    const { td, actions } = host();
    drag(td, [-100, -300]);
    td.fingerCancel();
    settle(td);
    expect(actions).toEqual(['started:next', 'ended:next:cancelled']);
  });

  it('pulls against the end of the book without turning, and comes to rest unannounced', () => {
    const { td, actions, pages } = host();
    pages.can.next = false;
    drag(td, [-40, -120]);
    expect(td.mode).toMatchObject({ kind: 'tracking', hasIncoming: false });
    const frame = td.step(16);
    expect(frame).toMatchObject({ kind: 'turning', incoming: null });
    expect(frame.kind === 'turning' && frame.dx > -120 && frame.dx < 0).toBe(true);
    td.fingerUp(at(280), -120, 100);
    expect(td.mode.kind).toBe('boundary-elastic');
    settle(td);
    expect(actions).toEqual([]);
  });

  it('keeps keys from the page it holds', () => {
    const { td } = host();
    drag(td, [-60]);
    expect(td.command('next')).toBe(false);
  });
});

describe('a turn ended from outside', () => {
  it('ends interrupted where it is when something else moves the reader', () => {
    const { td, actions } = host();
    td.command('next');
    td.step(16);
    td.interrupt();
    expect(actions.at(-1)).toBe('ended:next:interrupted');
    expect(td.isAnimating).toBe(false);
    expect(td.step(16)).toEqual({ kind: 'single', slot: 'curr' });
  });

  it('lands a landed turn, and sends a held one back, when something is asked directly', () => {
    const turned = host();
    turned.td.command('next');
    turned.td.settleNow();
    expect(turned.actions.at(-1)).toBe('ended:next:committed');
    expect(turned.td.isAnimating).toBe(false);

    const held = host();
    drag(held.td, [-200]);
    held.td.settleNow();
    expect(held.actions.at(-1)).toBe('ended:next:cancelled');
  });

  it('stops telling a listener once it unsubscribes', () => {
    const { td } = host();
    const seen: string[] = [];
    const stop = td.onAction((action) => seen.push(action.kind));
    stop();
    td.command('next');
    expect(seen).toEqual([]);
  });
});
