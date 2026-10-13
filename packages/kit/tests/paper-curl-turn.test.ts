import { describe, expect, it } from 'vitest';
import type { TransitionFrame, TransitionPage, TransitionScene } from '../src/driver/effects';
import type { TransitionSettle } from '../src/driver/physics';
import { paperTurnWith } from '../src/driver/paper/paper-turn';
import type { PaperRenderer } from '../src/driver/paper/renderer';

/**
 * The paper turn with one page a spread, drawn by a GPU that only says how
 * far over the page was in each frame it was asked to draw.
 */
function staged(density = 1) {
  const places: number[] = [];
  const renderer: PaperRenderer = {
    epoch: 1,
    standing: 'ready',
    prepare: () => undefined,
    snapshot: () => null,
    release: () => undefined,
    draw: (frame) => {
      // The page first lifted comes first in the book: the one the finger took.
      places.push(frame.sheets.find((sheet) => !sheet.still)?.shown ?? Number.NaN);
      return {} as CanvasImageSource;
    },
  };
  const clock = { now: 1000 };
  const effect = paperTurnWith(renderer, { now: () => clock.now });
  // A page is told from another by its bitmap: each spread keeps the one it has.
  const pages = [3, 4, 5].map(
    (spread): TransitionPage => ({
      spread,
      content: { spread } as unknown as CanvasImageSource,
      overlay: null,
      pixelRatio: 1,
      version: 0,
    }),
  );
  const scene: TransitionScene = {
    context: { drawImage: () => undefined } as unknown as CanvasRenderingContext2D,
    width: 400 * density,
    height: 600 * density,
    cssPixel: density,
    spine: 0,
    page: (slot) => pages[['prev', 'curr', 'next'].indexOf(slot)] ?? null,
    drawPage: () => undefined,
  };
  /** A frame of the turn on to the next page, the finger down at x 220 and at `x`, in CSS px. */
  const frame = (phase: TransitionFrame['phase'], x: number, dx: number): TransitionFrame => ({
    dx: dx * density,
    width: 400 * density,
    incoming: 'next',
    phase,
    velocity: 0,
    touch: {
      origin: { x: 220 * density, y: 300 * density },
      position: { x: x * density, y: 300 * density },
    },
  });
  /** Paints a frame `after` ms on; returns how far over the page was drawn. */
  const paint = (of: TransitionFrame, after = 16): number => {
    clock.now += after;
    effect.paint(scene, of);
    return places.at(-1) ?? Number.NaN;
  };
  /** The finger at `x`, its turn half the finger's way across. */
  const held = (x: number, after = 16): number => paint(frame('held', x, -(220 - x) / 2), after);
  /** Steps a turn let go at `x` to its end as the driver does; returns where each frame drew the page. */
  const letGo = (settle: TransitionSettle, phase: 'landing' | 'returning', x: number): number[] => {
    const drawn: number[] = [];
    for (let step = 1; step <= 120; step += 1) {
      const at = settle(step * 0.016);
      if (at.done) return drawn;
      drawn.push(paint(frame(phase, x, at.x)));
    }
    throw new Error('the turn did not end');
  };
  /** The page taken at mid page and brought under the finger at 150. */
  const underFinger = (): number => {
    held(200);
    held(150);
    let last = Number.NaN;
    for (let count = 0; count < 20; count += 1) last = held(150);
    return last;
  };
  /**
   * The page after it turned by a key, the one the finger had left to itself: how many
   * frames that one takes to leave.
   */
  const leftAlone = (): number => {
    pages.shift();
    pages.push({ ...(pages[1] as TransitionPage), spread: 6, content: {} as CanvasImageSource });
    const key = { ...frame('landing', 0, 0), touch: null };
    let last = places.at(-1) ?? 0;
    for (let count = 1; count <= 60; count += 1) {
      // Once it has left it is out of the book, and the page turned after it is the first drawn.
      const first = paint({ ...key, dx: -count * density });
      if (first < last) return count;
      last = first;
    }
    throw new Error('the page left to itself did not leave');
  };
  return { effect, held, letGo, underFinger, leftAlone };
}

describe('a page curled over, turned by a finger', () => {
  it('is where the finger has it still when a frame is long in coming', () => {
    const { held, underFinger } = staged();
    const under = underFinger();
    expect(under).toBeGreaterThan(0.35);
    // Half a second without a frame: it is not taken for a page of another turn and begun anew.
    expect(held(150, 500)).toBeCloseTo(under, 6);
    expect(held(150)).toBeCloseTo(under, 6);
  });

  it('let go to turn, finishes by itself and its turn is over as soon as it is out of the frame', () => {
    const { effect, letGo, underFinger } = staged();
    const under = underFinger();
    const settle = effect.physics?.settle?.(-35, 0, -400);
    if (!settle) throw new Error('no motion');
    const drawn = letGo(settle, 'landing', 150);
    // It is off in the frame it is let go in, from where it was: no leap, and only ever on.
    expect((drawn[0] ?? 0) - under).toBeLessThan(0.05);
    drawn.reduce((before, now) => {
      expect(now).toBeGreaterThanOrEqual(before);
      return now;
    }, under);
    const out = drawn.indexOf(1);
    expect(out).toBeGreaterThan(4);
    // One frame is drawn of it there, and no more: nothing waits for a motion nobody sees.
    expect(drawn.length - out).toBeLessThanOrEqual(2);
    expect(drawn.length).toBeLessThan(16);
  });

  it('let go with its turn where it began, goes back by itself and the turn waits for it', () => {
    const { effect, held, letGo, underFinger } = staged();
    underFinger();
    // The finger takes it back to where it came down: the turn is at its start, the page in the hand.
    let under = Number.NaN;
    for (let x = 160; x <= 220; x += 10) under = held(x);
    expect(under).toBeGreaterThan(0.25);
    const settle = effect.physics?.settle?.(0, 0, 0);
    if (!settle) throw new Error('no motion');
    const drawn = letGo(settle, 'returning', 220);
    // It goes on back as it was going: 5 px of line a frame, and a little more to be flat in time.
    expect(under - (drawn[0] ?? 0)).toBeGreaterThan(0.01);
    expect(under - (drawn[0] ?? 0)).toBeLessThan(0.03);
    drawn.reduce((before, now) => {
      expect(now).toBeLessThanOrEqual(before);
      return now;
    }, under);
    // It took its time lying down, and the turn was not over before it had.
    expect(drawn.indexOf(0)).toBeGreaterThan(4);
    expect(drawn.length - drawn.indexOf(0)).toBeLessThanOrEqual(2);
  });

  it('takes as long by itself whatever its frame is drawn at, let go or left for another page', () => {
    const letGoIn = (density: number): number => {
      const { effect, letGo, underFinger } = staged(density);
      underFinger();
      const settle = effect.physics?.settle?.(-35, 0, -400);
      if (!settle) throw new Error('no motion');
      return letGo(settle, 'landing', 150).length;
    };
    expect(letGoIn(3)).toBe(letGoIn(1));
    const leftIn = (density: number): number => {
      const { leftAlone, underFinger } = staged(density);
      underFinger();
      return leftAlone();
    };
    expect(leftIn(1)).toBeGreaterThan(5);
    expect(leftIn(3)).toBe(leftIn(1));
  });

  it('gone from the frame, has nothing left for a turn that cuts in to carry on with', () => {
    const { effect, letGo, underFinger } = staged();
    underFinger();
    const settle = effect.physics?.settle?.(-35, 0, -400);
    if (!settle) throw new Error('no motion');
    const moving = {
      dx: -200,
      velocity: -900,
      width: 400,
      direction: 'backward',
      sameSpreads: true,
    };
    expect(effect.physics?.begins?.({ ...moving, direction: 'backward' })).toEqual({
      dx: -200,
      velocity: -900,
    });
    letGo(settle, 'landing', 150);
    expect(effect.physics?.begins?.({ ...moving, direction: 'backward' })).toEqual({
      dx: -200,
      velocity: 0,
    });
  });
});
