import { describe, expect, it, vi } from 'vitest';
import type { TransitionFrame, TransitionPage, TransitionScene } from '../src/driver/effects';
import { createPaperPhysics, grabOf } from '../src/driver/paper/paper-physics';
import { createPaperTurn } from '../src/driver/paper/paper-turn';
import { springSettle, stepSpring } from '../src/driver/spring';
import { createFakeGl } from './helpers/fake-gl';

const one = { width: 400, spine: 0 };
const two = { width: 400, spine: 200 };
const touch = (fromX: number, toX: number, y = 300) => ({
  origin: { x: fromX, y },
  position: { x: toX, y },
});

const physics = createPaperPhysics;

describe('how far a finger carries a paper turn', () => {
  const paper = physics();
  const travel = (points: ReturnType<typeof touch>, bounds: typeof one): number =>
    paper.travel?.(points, bounds) ?? Number.NaN;

  it('keeps the held point under the finger: over the spine at half a turn', () => {
    // Two pages: taken 180 px right of the spine and carried to it.
    expect(travel(touch(380, 200), two)).toBeCloseTo(-200, 6);
    expect(travel(touch(380, 380), one)).toBe(0);
  });

  it('carries the edge of one page as far as the finger goes, wherever it went down', () => {
    // The edge of a page 400 wide comes over the spine after the finger has gone 400: half a turn.
    expect(travel(touch(380, 180), one)).toBeCloseTo(-400 * (200 / 800), 6);
    expect(travel(touch(250, 50), one)).toBeCloseTo(-400 * (200 / 800), 6);
    // Back the same: the page before comes in by half what the finger has gone, from nothing.
    expect(travel(touch(60, 100), one)).toBeCloseTo(400 * (40 / 800), 6);
    expect(travel(touch(60, 66), one)).toBeCloseTo(400 * (6 / 800), 6);
  });

  it('turns back by the sheet lying left of the spine', () => {
    // Two pages: taken 160 px left of the spine and carried to it.
    expect(travel(touch(40, 200), two)).toBeCloseTo(200, 6);
  });

  it('takes a sheet no nearer the spine than a hand could turn it by', () => {
    expect(grabOf(touch(210, 200), { ...two, height: 600 }).u).toBe(0.35);
    expect(grabOf(touch(390, 380, 150), { ...two, height: 600 })).toEqual({ u: 0.95, v: 0.25 });
    // One page is taken by its outer edge, whichever way it is turned.
    expect(grabOf(touch(20, 10), { ...one, height: 600 }).u).toBe(1);
    expect(grabOf(touch(20, 60), { ...one, height: 600 }).u).toBe(1);
    // A turn no finger started takes the outer edge, toward the lower corner.
    expect(grabOf(null, { ...one, height: 600 })).toEqual({ u: 1, v: 0.86 });
  });
});

describe('whether letting a paper turn go turns the page', () => {
  const paper = physics();
  const release = (dx: number, velocity: number, fromX: number, toX: number) =>
    paper.lands?.({
      dx,
      from: 0,
      velocity,
      width: 400,
      direction: 'forward',
      touch: touch(fromX, toX),
    });

  it('a pull of a fifth of the way or a flick does, a nudge or a pull back does not', () => {
    expect(release(-100, 0, 380, 190)).toBe(true);
    expect(release(-40, -500, 380, 300)).toBe(true);
    expect(release(-40, 0, 380, 300)).toBe(false);
    expect(release(-8, -900, 380, 365)).toBe(false);
    expect(release(-200, 150, 380, 0)).toBe(false);
  });
});

describe('whether letting a page curled over go turns it', () => {
  const paper = physics();
  /** A finger down at `from`, at `to` when it lifts, having been as far as `farthest`; the turn going at `velocity`. */
  const release = (
    from: number,
    to: number,
    farthest = to,
    velocity = 0,
    direction: 'forward' | 'backward' = 'forward',
  ) =>
    paper.lands?.({
      // Under a finger the page is where the finger is, whatever the turn's own way says.
      dx: (to - from) / 2,
      from: 0,
      velocity,
      width: 400,
      direction,
      touch: { ...touch(from, to), farthest: { x: farthest, y: 300 } },
      spine: 0,
    });

  it('a pull out does, however short; a nudge does not', () => {
    expect(release(250, 220)).toBe(true);
    expect(release(250, 226)).toBe(true);
    expect(release(250, 228)).toBe(false);
    expect(release(250, 250)).toBe(false);
    // A page brought back goes by the same, the other way.
    expect(release(60, 90, 90, 0, 'backward')).toBe(true);
    expect(release(60, 80, 80, 0, 'backward')).toBe(false);
    // Left out, the farthest the finger has been is where it is.
    expect(
      paper.lands?.({
        dx: -15,
        from: 0,
        velocity: 0,
        width: 400,
        direction: 'forward',
        touch: touch(250, 220),
        spine: 0,
      }),
    ).toBe(true);
  });

  it('a finger come back from its farthest does not, more of it after a long pull', () => {
    // Out 60, back 20: within what a hand gives as it lifts.
    expect(release(250, 210, 190)).toBe(true);
    expect(release(250, 216, 190)).toBe(false);
    // Out 300 and relaxed by 60 turns still; brought back 90 does not.
    expect(release(380, 140, 80)).toBe(true);
    expect(release(380, 170, 80)).toBe(false);
    // Back past where it came down.
    expect(release(250, 270, 150)).toBe(false);
    expect(release(60, 120, 200, 0, 'backward')).toBe(false);
  });

  it('a finger flinging it back does not, whatever it had pulled', () => {
    // The turn goes half as fast as the finger: 260 a second of it is the finger at 520.
    expect(release(250, 150, 140, 260)).toBe(false);
    expect(release(250, 150, 140, 240)).toBe(true);
    // Going on, however fast, is no reason to go back.
    expect(release(250, 150, 150, -900)).toBe(true);
    expect(release(60, 160, 170, -260, 'backward')).toBe(false);
  });

  it('is asked of one page a spread only: a leaf of two goes by how far its turn has gone', () => {
    const leaf = (spine: number | undefined) =>
      paper.lands?.({
        dx: -15,
        from: 0,
        velocity: 0,
        width: 400,
        direction: 'forward',
        touch: touch(380, 350),
        ...(spine === undefined ? {} : { spine }),
      });
    expect(leaf(0)).toBe(true);
    expect(leaf(200)).toBe(false);
    // A caller that does not say where the pages are bound gets the leaf's rule.
    expect(leaf(undefined)).toBe(false);
  });
});

describe('how a paper turn comes to rest', () => {
  it('a leaf no finger turned is off at once, lands softly, and takes well under half a second', () => {
    const settle = physics().settle?.(0, 0, -800);
    if (!settle) throw new Error('the paper turn carries a released turn itself');
    expect(settle(0)).toMatchObject({ x: 0, done: false });
    // Nearly a quarter of the way in the first fifth of the time, two thirds by half time.
    expect(settle(0.076).x / -800).toBeGreaterThan(0.22);
    expect(settle(0.19).x / -800).toBeCloseTo(0.658, 2);
    expect(Math.abs(settle(0.36).velocity)).toBeLessThan(Math.abs(settle(0.1).velocity) / 4);
    expect(settle(0.37).done).toBe(false);
    // A shorter way takes less time, though never none.
    const nudge = physics().settle?.(-40, 0, 0);
    expect(nudge?.(0.15).x).toBeLessThan(0);
    expect(nudge?.(0.25).x).toBe(0);
  });

  it('a turn let go on the move keeps its momentum', () => {
    const settle = physics().settle?.(-100, -900, -400);
    expect(settle?.(0.016).velocity).toBeLessThan(-700);
  });

  it('draws the leaf exactly where it lands before the turn is over', () => {
    const settle = physics().settle?.(0, 0, -800);
    if (!settle) throw new Error('the paper turn carries a released turn itself');
    expect(settle(0.38)).toEqual({ x: -800, velocity: 0, done: false });
    expect(settle(0.397)).toEqual({ x: -800, velocity: 0, done: true });
  });
});

describe('a paper turn that cuts into another', () => {
  const left = { dx: 150, velocity: -900, width: 400, direction: 'forward' as const };

  it('takes up the same leaf where it is, and lifts another from flat', () => {
    const paper = physics();
    // Turned back: the same sheet, from where it is and as fast.
    expect(paper.begins?.({ ...left, direction: 'backward', sameSpreads: true })).toEqual({
      dx: 150,
      velocity: -900,
    });
    // Turned on: the next sheet starts flat; the one in the air is the effect's to bring down.
    expect(paper.begins?.({ ...left, sameSpreads: false })).toEqual({ dx: 0, velocity: 0 });
  });

  it('is not over while a leaf it left in the air is still coming down', () => {
    let aloft = true;
    const settle = physics(() => aloft).settle?.(0, 0, -800);
    if (!settle) throw new Error('the paper turn carries a released turn itself');
    settle(0.38);
    expect(settle(0.4)).toEqual({ x: -800, velocity: 0, done: false });
    expect(settle(0.6).done).toBe(false);
    aloft = false;
    expect(settle(0.62)).toEqual({ x: -800, velocity: 0, done: true });
  });

  it('sent back the way it came, slows to a stop before it comes back', () => {
    const settle = physics().settle?.(-300, -1400, 0);
    if (!settle) throw new Error('the paper turn carries a released turn itself');
    // It carries on, slower and slower, for a tenth of a second.
    expect(settle(0).velocity).toBeCloseTo(-1400, 6);
    expect(settle(0.05).x).toBeLessThan(-300);
    expect(settle(0.05).velocity).toBeCloseTo(-700, 6);
    const stopped = settle(0.1);
    expect(stopped.x).toBeCloseTo(-370, 6);
    expect(stopped.velocity).toBeCloseTo(0, 6);
    // Then back at its own pace, never the old way again.
    expect(settle(0.15).x).toBeGreaterThan(stopped.x);
    expect(settle(0.15).velocity).toBeGreaterThan(0);
    expect(settle(0.6).x).toBe(0);
  });

  it('is over a frame after its page is where it takes it, with its own motion still on its way', () => {
    const picture = { painted: 0, there: false };
    const paper = physics(() => false, {
      painted: () => picture.painted,
      there: () => picture.there,
      gone: () => false,
    });
    const settle = paper.settle?.(100, 0, 400);
    if (!settle) throw new Error('the paper turn carries a released turn itself');
    expect(settle(0.05).done).toBe(false);
    // The page lies flat again, but no frame has shown it so since the turn was let go.
    picture.there = true;
    expect(settle(0.06).x).toBeLessThan(400);
    picture.painted = 1;
    expect(settle(0.08)).toEqual({ x: 400, velocity: 0, done: false });
    expect(settle(0.1)).toEqual({ x: 400, velocity: 0, done: true });
  });

  it('with nowhere left to go is there, whatever speed it was let go at', () => {
    const settle = physics().settle?.(-400, -900, -400);
    expect(settle?.(0)).toEqual({ x: -400, velocity: 0, done: false });
    expect(settle?.(0.016)).toEqual({ x: -400, velocity: 0, done: true });
  });

  it('is let go by what the finger carried it, wherever the finger took it', () => {
    const paper = physics();
    const release = (dx: number, from: number): boolean | undefined =>
      paper.lands?.({
        dx,
        from,
        velocity: 0,
        width: 400,
        direction: 'backward',
        touch: touch(100, 100 + (dx - from)),
      });
    // Taken 170 px short of lying flat again: a nudge leaves it, a pull of a quarter turns it back.
    expect(release(200, 170)).toBe(false);
    expect(release(270, 170)).toBe(true);
  });
});

describe('the spring as a motion', () => {
  it('follows the path the stepped spring does', () => {
    const config = { stiffness: 180, damping: 27 };
    const settle = springSettle(config, -60, -1200, -800);
    const stepped = { x: -60, vx: -1200 };
    for (let frame = 1; frame <= 40; frame += 1) {
      stepSpring(stepped, -800, config, 16);
      const at = settle(frame * 0.016);
      expect(at.x).toBeCloseTo(stepped.x, 6);
      expect(at.velocity).toBeCloseTo(stepped.vx, 5);
    }
  });
});

describe('a paper turn where there is no GPU', () => {
  function scene(spine: number) {
    const drawn: string[] = [];
    const page = (slot: string): TransitionPage => ({
      spread: ['prev', 'curr', 'next'].indexOf(slot),
      texture: { slot } as unknown as WebGLTexture,
      width: 400,
      height: 600,
      pixelRatio: 1,
      version: 0,
    });
    // The paper's programs do not link here: the GPU cannot draw them.
    const fake: TransitionScene = {
      gl: createFakeGl(undefined, { programsLink: false }).gl,
      width: 400,
      height: 600,
      cssPixel: 1,
      spine,
      page,
      drawPage: (slot, x) => drawn.push(`${slot}@${String(x)}`),
    };
    return { fake, drawn };
  }
  const frame = (dx: number, incoming: TransitionFrame['incoming']): TransitionFrame => ({
    dx,
    width: 400,
    incoming,
    phase: 'landing',
    velocity: 0,
    touch: null,
  });

  it('turns as the built-in cover does, and its turn ends with the hand', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const effect = createPaperTurn({ now: () => 0 });
    const { fake, drawn } = scene(0);
    effect.paint(fake, frame(-100, 'next'));
    expect(drawn).toEqual(['curr@0', 'next@300']);
    const settle = effect.physics?.settle?.(-100, 0, -400);
    expect(settle?.(2)).toEqual({ x: -400, velocity: 0, done: false });
    expect(settle?.(2.02).done).toBe(true);
    error.mockRestore();
  });

  it('slides a single page against the start of the book', () => {
    const effect = createPaperTurn({ now: () => 0 });
    const { fake, drawn } = scene(0);
    effect.paint(fake, frame(30, null));
    expect(drawn).toEqual(['curr@30']);
  });
});
