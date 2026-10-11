import { describe, expect, it, vi } from 'vitest';
import type { TransitionPhysics } from '../src/driver/physics';
import { createTransitionDriver } from '../src/driver/transition-driver';
import type { DrawInstruction, SettledEvent, TransitionDriverOptions } from '../src/driver/types';

const W = 400;

type Turning = DrawInstruction & { kind: 'turning' };

function driver(options?: Partial<TransitionDriverOptions>) {
  const td = createTransitionDriver(options);
  td.viewportWidth = W;
  const settled: SettledEvent[] = [];
  td.onSettled((event) => settled.push(event));
  const rest = vi.fn();
  td.onRest(rest);
  return { td, settled, rest };
}

/** The frame the driver would draw now, without moving it on. */
function frame(td: ReturnType<typeof createTransitionDriver>): Turning {
  const instruction = td.step(0);
  if (instruction.kind !== 'turning') throw new Error('nothing is turning');
  return instruction;
}

/** Runs the driver to rest and returns every frame on the way. */
function frames(td: ReturnType<typeof createTransitionDriver>): Turning[] {
  const seen: Turning[] = [];
  for (let step = 0; step < 600 && td.isAnimating; step += 1) {
    const instruction = td.step(16);
    if (instruction.kind === 'turning') seen.push(instruction);
  }
  if (td.isAnimating) throw new Error('never came to rest');
  return seen;
}

/** A turn to the next spread, part of the way there. */
function inFlight(td: ReturnType<typeof createTransitionDriver>, ms = 96): Turning {
  td.goToTarget('forward', 0, 1);
  for (let elapsed = 0; elapsed < ms; elapsed += 16) td.step(16);
  return frame(td);
}

describe('a turn that is cut into', () => {
  it('is settled at once and carries its picture on, the page it left still leaving', () => {
    const { td, settled, rest } = driver();
    const before = inFlight(td);
    expect(before.dx).toBeLessThan(0);

    td.handOver();

    expect(settled).toEqual([{ direction: 'forward', committed: true, targetSpread: 1 }]);
    expect(td.turning).toBe(false);
    expect(td.isAnimating).toBe(true);
    // The same picture in the coordinates of the spread it landed on, moving as fast.
    const left = frame(td);
    expect(left).toMatchObject({ incoming: 'prev', phase: 'returning', touch: null });
    expect(left.dx).toBeCloseTo(before.dx + W, 6);
    expect(left.velocity).toBeCloseTo(before.velocity, 6);

    const rest_of_it = frames(td);
    expect(rest_of_it.every((seen) => seen.incoming === 'prev' && seen.dx >= 0)).toBe(true);
    // Coming to rest reports nothing more: the turn was reported when it was cut into.
    expect(settled).toHaveLength(1);
    expect(rest).toHaveBeenCalledOnce();
  });

  it('stays where it is when it was going back, or pulling against the end of the book', () => {
    const back = driver();
    back.td.startTracking('forward', 0, 1, 0);
    back.td.updateTracking(-120, 16);
    back.td.cancelTracking();
    back.td.step(16);
    const returning = frame(back.td);
    back.td.handOver();
    expect(back.settled).toEqual([{ direction: 'forward', committed: false, targetSpread: 0 }]);
    expect(frame(back.td)).toMatchObject({
      incoming: 'next',
      dx: returning.dx,
      phase: 'returning',
    });

    const pull = driver();
    pull.td.startTracking('forward', 3, null, 0);
    pull.td.updateTracking(-120, 16);
    pull.td.releaseTracking();
    pull.td.step(16);
    const pulled = frame(pull.td);
    pull.td.handOver();
    expect(pull.settled).toEqual([{ direction: 'forward', committed: false, targetSpread: 3 }]);
    expect(frame(pull.td)).toMatchObject({ incoming: null, dx: pulled.dx, phase: 'returning' });
  });

  it('lands a turn a finger still holds, as fast as the finger moved it', () => {
    const { td, settled } = driver();
    td.startTracking('forward', 0, 1, 0);
    td.updateTracking(-60, 10);
    td.updateTracking(-120, 20);
    td.handOver();
    expect(settled).toEqual([{ direction: 'forward', committed: true, targetSpread: 1 }]);
    // 6 px a millisecond, handed on in px a second.
    expect(td.mode).toMatchObject({ kind: 'finishing', leaving: 'prev', dx: W - 120 });
    expect((td.mode as { vx: number }).vx).toBeCloseTo(-6000, 6);
  });

  it('reports nothing when no turn is open', () => {
    const { td, settled } = driver();
    td.handOver();
    expect(settled).toEqual([]);
    expect(td.isAnimating).toBe(false);

    inFlight(td);
    td.handOver();
    td.handOver();
    expect(settled).toHaveLength(1);
    // Stopping what is left reports nothing either.
    expect(td.forceSettle()).toBeGreaterThan(0);
    expect(td.isAnimating).toBe(false);
    expect(settled).toHaveLength(1);
  });

  it('has nothing left to show when turns land at once', () => {
    const { td, settled } = driver({ effect: 'none' });
    td.startTracking('forward', 0, 1, 0);
    td.updateTracking(-120, 16);
    td.handOver();
    expect(settled).toHaveLength(1);
    expect(td.isAnimating).toBe(false);
  });

  it('keeps the motion it was on rather than starting one', () => {
    // A turn that takes one second whatever is left of it.
    const settle = vi.fn<NonNullable<TransitionPhysics['settle']>>(
      (from, _velocity, to) => (seconds) => ({
        x: from + (to - from) * Math.min(1, seconds),
        velocity: to - from,
        done: seconds >= 1,
      }),
    );
    const { td } = driver({ physics: { settle } });
    td.goToTarget('forward', 0, 1);
    td.step(500);
    expect(frame(td).dx).toBeCloseTo(-W / 2, 6);

    td.handOver();
    expect(settle).toHaveBeenCalledOnce();
    td.step(250);
    // Three quarters of the way through that same second.
    expect(frame(td).dx).toBeCloseTo(W / 4, 6);
    td.step(250);
    expect(td.isAnimating).toBe(false);
  });
});

describe('the turn that cuts in', () => {
  it('begins where the picture is, as fast, and names the page still leaving until it has crossed its own start', () => {
    const { td, settled } = driver();
    const before = inFlight(td);
    td.handOver();
    td.goToTarget('forward', 1, 2);

    expect(td.turning).toBe(true);
    expect(td.mode).toMatchObject({ kind: 'settling', direction: 'forward', target: -W });
    const first = frame(td);
    expect(first.dx).toBeCloseTo(before.dx + W, 6);
    expect(first.velocity).toBeCloseTo(before.velocity, 6);
    expect(first).toMatchObject({ incoming: 'prev', phase: 'returning' });

    const seen = [first, ...frames(td)];
    const crossed = seen.findIndex((at) => at.dx <= 0);
    expect(crossed).toBeGreaterThan(0);
    expect(seen.slice(0, crossed).every((at) => at.incoming === 'prev')).toBe(true);
    expect(seen.slice(crossed).every((at) => at.incoming === 'next')).toBe(true);
    // One motion: the picture never moves back on itself.
    for (let index = 1; index < seen.length; index += 1) {
      expect(seen[index]?.dx).toBeLessThanOrEqual(seen[index - 1]?.dx ?? 0);
    }
    expect(settled).toEqual([
      { direction: 'forward', committed: true, targetSpread: 1 },
      { direction: 'forward', committed: true, targetSpread: 2 },
    ]);
  });

  it('turns the same page back from where it is, slowing before it goes the other way', () => {
    const { td, settled } = driver();
    const before = inFlight(td);
    td.handOver();
    td.goToTarget('backward', 1, 0);

    const first = frame(td);
    expect(first).toMatchObject({ incoming: 'prev', phase: 'landing' });
    expect(first.dx).toBeCloseTo(before.dx + W, 6);
    expect(first.velocity).toBeLessThan(0);

    const seen = frames(td);
    expect(seen.every((at) => at.incoming === 'prev' && at.dx >= 0 && at.dx <= W)).toBe(true);
    // It carries on the way it was going a little, then comes back.
    expect(Math.min(...seen.map((at) => at.dx))).toBeLessThan(first.dx);
    expect(settled[1]).toEqual({ direction: 'backward', committed: true, targetSpread: 0 });
  });

  it('is never more than a page from rest, however often turns are cut into', () => {
    const { td } = driver();
    inFlight(td, 32);
    td.handOver();
    td.goToTarget('forward', 1, 2);
    // Still on the far side of its start: a page and more would be left of it.
    expect(frame(td).dx).toBeGreaterThan(0);
    td.handOver();
    expect(frame(td)).toMatchObject({ incoming: 'prev', dx: W });
  });

  it('under a finger starts where the picture is and adds only what the finger carries', () => {
    const { td } = driver();
    const before = inFlight(td);
    td.handOver();
    const left = before.dx + W;

    td.startTracking('forward', 1, null, 1000);
    expect(frame(td)).toMatchObject({ incoming: 'prev', phase: 'held' });
    expect(frame(td).dx).toBeCloseTo(left, 6);
    // A pull against the end of the book resists the pull, not what was left of the turn.
    td.updateTracking(-40, 1016);
    const pulled = frame(td).dx - left;
    expect(pulled).toBeLessThan(0);
    expect(pulled).toBeGreaterThan(-40);
    expect(frame(td).incoming).toBe('prev');
  });

  it('lets go by what the finger carried it, not by where the turn before had left it', () => {
    const lands = vi.fn<NonNullable<TransitionPhysics['lands']>>(() => true);
    for (const physics of [undefined, { lands }]) {
      const { td } = driver(physics ? { physics } : {});
      inFlight(td);
      td.handOver();
      td.goToTarget('forward', 1, 2);
      const from = td.interrupt(1000)?.dx ?? 0;
      expect(from).toBeGreaterThan(120);
      td.updateTracking(-60, 1010);
      td.updateTracking(-120, 1020);
      // Still short of its own start, and a flick toward the next spread all the same.
      expect(frame(td).dx).toBeCloseTo(from - 120, 6);
      expect(td.releaseTracking()).toBe('commit');
    }
    // Physics an application writes are told where the finger took the turn.
    expect(lands).toHaveBeenCalledOnce();
    expect(lands.mock.calls[0]?.[0].from).toBeGreaterThan(120);
  });

  it('measures the finger from when it took hold', () => {
    const { td } = driver();
    td.startTracking('forward', 0, 1, 0);
    td.updateTracking(-60, 10);
    td.updateTracking(-240, 20);
    td.releaseTracking();
    td.step(16);
    td.interrupt(1000);
    td.updateTracking(0, 1016);
    // The finger has not moved since: the flick before it took hold says nothing of it.
    expect(td.mode).toMatchObject({ kind: 'tracking', vx: 0 });
  });
});
