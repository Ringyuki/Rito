import { describe, expect, it, vi } from 'vitest';
import type { TransitionFrame, TransitionPage, TransitionScene } from '../src/driver/effects';
import { createPaperPhysics, grabOf } from '../src/driver/paper/paper-physics';
import { createPaperTurn } from '../src/driver/paper/paper-turn';
import { springSettle, stepSpring } from '../src/driver/spring';

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
    // One page: the same finger travel is a smaller share of a wider sheet.
    expect(travel(touch(380, 180), one)).toBeCloseTo(-400 * (200 / 760), 6);
    expect(travel(touch(380, 380), one)).toBe(0);
  });

  it('turns back by the sheet lying left of the spine, or brings it in from out of sight', () => {
    // Two pages: taken 160 px left of the spine and carried to it.
    expect(travel(touch(40, 200), two)).toBeCloseTo(200, 6);
    // One page: the last sheet comes over the spine to meet the finger where it is.
    expect(travel(touch(60, 100), one)).toBeCloseTo(400 * (1 - 300 / 800), 6);
  });

  it('takes a sheet no nearer the spine than a hand could turn it by', () => {
    expect(grabOf(touch(20, 10), { ...one, height: 600 }).u).toBe(0.35);
    expect(grabOf(touch(380, 370, 150), { ...one, height: 600 })).toEqual({ u: 0.95, v: 0.25 });
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
      content: { slot } as unknown as CanvasImageSource,
      overlay: null,
      pixelRatio: 1,
      version: 0,
    });
    const fake: TransitionScene = {
      context: {} as CanvasRenderingContext2D,
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
