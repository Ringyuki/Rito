import { describe, expect, it } from 'vitest';
import type { TransitionFrame, TransitionScene } from '../src/driver/effects';
import { lineAt } from '../src/driver/paper/curl';
import { curledFlat, isThere, wantedCurled } from '../src/driver/paper/curled';
import { fly, type Leaf } from '../src/driver/paper/leaves';
import type { LeafTurn } from '../src/driver/paper/swing';
import {
  edgeGoneAt,
  forward,
  lineAtHeight,
  page,
  ROLL_RADIUS,
  scene,
  sheet,
} from './helpers/curled-page';

const FRAME = 1 / 60;
type Point = readonly [number, number];

/** A frame of a turn whose finger came down at `from` and is, or was when it let go, at `to`. */
const fingered = (
  phase: TransitionFrame['phase'],
  from: Point,
  to: Point,
  incoming: TransitionFrame['incoming'] = 'next',
): TransitionFrame => ({
  dx: 0,
  width: 400,
  incoming,
  phase,
  velocity: 0,
  touch: { origin: { x: from[0], y: from[1] }, position: { x: to[0], y: to[1] } },
});

/** The turn a finger has carried: half its own way across, turning on or bringing back. */
function carried(from: Point, to: Point, on: boolean): LeafTurn {
  const along = Math.min(1, Math.max(0, (on ? from[0] - to[0] : to[0] - from[0]) / 800));
  return { ...forward(on ? along : 1 - along), forward: on };
}

function placed(leaf: Leaf, of: TransitionFrame, turn: LeafTurn, seconds: number): number {
  const curled = leaf.curled;
  if (!curled) throw new Error('not a curled page');
  leaf.shown = wantedCurled(leaf, curled, scene, of, turn, seconds);
  return leaf.shown;
}

/** Draws the page for its finger, `seconds` after its last frame. */
function drag(leaf: Leaf, from: Point, to: Point, seconds = FRAME, on = true): number {
  return placed(leaf, fingered('held', from, to), carried(from, to, on), seconds);
}

/** The finger staying where it is for `frames` more frames. */
function wait(leaf: Leaf, from: Point, to: Point, frames: number, on = true): void {
  for (let count = 0; count < frames; count += 1) drag(leaf, from, to, FRAME, on);
}

/** The finger letting go at `to`, its turn going on (`landing`) or back. */
function release(leaf: Leaf, phase: 'landing' | 'returning', from: Point, to: Point): number {
  return placed(leaf, fingered(phase, from, to), carried(from, to, true), FRAME);
}

/** What the first of a finger's way is eased to, on a page 400 wide. */
const eased = (gone: number): number => (gone * gone) / (gone + 0.008 * 400);

describe('a curled page under a finger that has yet to set off', () => {
  it('carries its edge as far as the finger has gone, from the first of its way', () => {
    const leaf = sheet(0);
    // The first frame it is drawn in already shows what the finger has gone.
    drag(leaf, [380, 300], [362, 300]);
    expect(edgeGoneAt(leaf, 300)).toBeCloseTo(eased(18), 0);
    for (const x of [376, 370, 364, 358, 357]) {
      drag(leaf, [380, 300], [x, 300]);
      expect(Math.abs(edgeGoneAt(leaf, 300) - eased(380 - x))).toBeLessThan(0.6);
    }
    expect(leaf.curled?.held?.setOff).toBe(false);
    // And back again by the way it came.
    expect(drag(leaf, [380, 300], [380, 300])).toBe(0);
    expect(drag(leaf, [380, 300], [395, 300])).toBe(0);
  });

  it('lifts nothing for a finger that goes up or down only, or the other way', () => {
    const leaf = sheet(0);
    for (let y = 300; y >= 100; y -= 4) expect(drag(leaf, [380, 300], [380, y])).toBe(0);
    // Its turn goes on, and the finger goes back: however far, that is not setting off.
    for (const x of [390, 420, 500]) expect(drag(leaf, [300, 300], [x, 300])).toBe(0);
    expect(leaf.curled?.held?.setOff).toBe(false);
  });

  it('keeps its distance from the finger: a slip from mid page lifts next to nothing', () => {
    const leaf = sheet(0);
    drag(leaf, [200, 300], [190, 300]);
    drag(leaf, [200, 300], [180, 300]);
    // The finger is 220 from the edge it would be brought to; the edge has gone 17.
    expect(edgeGoneAt(leaf, 300)).toBeLessThan(18);
    wait(leaf, [200, 300], [180, 300], 30);
    expect(edgeGoneAt(leaf, 300)).toBeLessThan(18);
  });
});

describe('a curled page whose finger has set off', () => {
  /** A page taken at mid page and mid height, its finger just set off. */
  function setOff(from: Point = [220, 300]): { leaf: Leaf; gap: number; at: Point } {
    const leaf = sheet(0);
    const at: Point = [from[0] - 30, from[1]];
    drag(leaf, from, [from[0] - 20, from[1]]);
    drag(leaf, from, at);
    return { leaf, gap: 400 - at[0] - eased(30), at };
  }

  it('is where it was in the frame the finger sets off, and gathers way from rest', () => {
    const { leaf, gap, at } = setOff();
    expect(leaf.curled?.held?.setOff).toBe(true);
    // That frame is drawn for the finger's own way, as the one before it was.
    expect(Math.abs(edgeGoneAt(leaf, 300) - eased(30))).toBeLessThan(0.6);
    // The next has it on its way: begun, and no leap.
    drag(leaf, [220, 300], at);
    const first = edgeGoneAt(leaf, 300) - eased(30);
    expect(first).toBeGreaterThan(0.05 * gap);
    expect(first).toBeLessThan(0.14 * gap);
  });

  it('comes to the finger with the finger at rest, never by much in a frame, and is under it in a quarter of a second', () => {
    const { leaf, gap, at } = setOff();
    let last = edgeGoneAt(leaf, 300);
    let most = 0;
    for (let count = 0; count < 15; count += 1) {
      drag(leaf, [220, 300], at);
      const now = edgeGoneAt(leaf, 300);
      expect(now).toBeGreaterThanOrEqual(last - 1e-6);
      most = Math.max(most, now - last);
      last = now;
    }
    expect(most).toBeLessThan(0.25 * gap);
    expect(most).toBeGreaterThan(0.15 * gap);
    // The edge of the paper turned over is where the finger is.
    expect(Math.abs(last - (400 - at[0]))).toBeLessThan(0.6);
    // A tenth of a second in it was nine tenths of the way.
    const again = setOff();
    wait(again.leaf, [220, 300], again.at, 6);
    const left = 400 - again.at[0] - edgeGoneAt(again.leaf, 300);
    expect(left).toBeLessThan(0.12 * gap);
    expect(left).toBeGreaterThan(0.06 * gap);
  });

  it('is under the finger from there wherever the finger goes, however fast, and back past where it came down', () => {
    const { leaf, at } = setOff();
    wait(leaf, [220, 300], at, 20);
    for (const [x, y, within] of [
      [120, 300, 0.6],
      [60, 200, 1.5],
      [150, 420, 1.5],
      // Where it came down: the page is not flat again, it is in the hand.
      [220, 300, 0.6],
      [300, 300, 0.6],
    ] as const) {
      drag(leaf, [220, 300], [x, y]);
      expect(Math.abs(edgeGoneAt(leaf, y) - (400 - x))).toBeLessThan(within);
      // The paper the finger holds is lifted.
      expect(lineAtHeight(leaf, y)).toBeLessThan(400);
    }
    // Brought to the page's own edge it lies flat.
    expect(drag(leaf, [220, 300], [400, 300])).toBe(0);
  });

  it('follows the finger while it is still coming to it', () => {
    const { leaf } = setOff();
    // The finger goes on 12 px a frame as the page comes: the gap closes all the same.
    let gap = Infinity;
    for (let x = 178; x >= 22; x -= 12) {
      drag(leaf, [220, 300], [x, 300]);
      const now = 400 - x - edgeGoneAt(leaf, 300);
      expect(now).toBeLessThan(gap);
      gap = now;
    }
    expect(Math.abs(gap)).toBeLessThan(0.6);
  });

  it('brought back, comes in until its edge is under the finger, lying flat left of its roll', () => {
    const leaf = sheet(1);
    // Before the finger has set off next to nothing shows: a sliver by the spine.
    drag(leaf, [30, 300], [50, 300], FRAME, false);
    expect(lineAtHeight(leaf, 300)).toBeGreaterThan(0);
    expect(lineAtHeight(leaf, 300)).toBeLessThan(8);
    // Its edge, out of the frame on the left, has come back just as far as the finger has gone.
    expect(Math.abs(edgeGoneAt(leaf, 300) - (800 - 20))).toBeLessThan(0.6);
    drag(leaf, [30, 300], [60, 300], FRAME, false);
    expect(leaf.curled?.held?.setOff).toBe(true);
    const sliver = lineAtHeight(leaf, 300);
    expect(sliver).toBeLessThan(10);
    let last = sliver;
    for (let count = 0; count < 20; count += 1) {
      drag(leaf, [30, 300], [60, 300], FRAME, false);
      expect(lineAtHeight(leaf, 300)).toBeGreaterThanOrEqual(last - 1e-6);
      last = lineAtHeight(leaf, 300);
    }
    expect(Math.abs(edgeGoneAt(leaf, 300) - 340)).toBeLessThan(0.6);
    // The paper leaves the page right of the finger: all that is left of it lies flat.
    expect(last).toBeGreaterThan(60);
    for (const [x, y, within] of [
      [200, 300, 0.6],
      [320, 200, 1.5],
      [120, 300, 0.6],
    ] as const) {
      drag(leaf, [30, 300], [x, y], FRAME, false);
      expect(Math.abs(edgeGoneAt(leaf, y) - (400 - x))).toBeLessThan(within);
      // Nearly flat again the edge is still round the roll, which stands a little past the
      // finger: all that is farther left of the finger than the roll is wide lies flat.
      expect(lineAtHeight(leaf, y)).toBeGreaterThan(x - ROLL_RADIUS);
    }
  });

  it('leans over to how it will lean under the finger without turning round, the paper it holds lifted all the way', () => {
    for (const [from, seconds, rises] of [
      // Low on the page and far from its edge: the corner it was peeled by has to stand up.
      [[220, 560], FRAME, false],
      [[90, 560], FRAME, false],
      // Free to lean more on its way there than at either end of it: it does not.
      [[220, 540], FRAME, false],
      // Higher: it could not lean as it was asked to until it had come over.
      [[220, 450], FRAME / 2, true],
    ] as const) {
      const { leaf, at } = setOff(from);
      const before = leaf.curled?.lean ?? Number.NaN;
      let last = before;
      for (let count = 0; count < 40; count += 1) {
        drag(leaf, from, at, seconds);
        const now = leaf.curled?.lean ?? Number.NaN;
        if (rises) expect(now).toBeGreaterThanOrEqual(last - 1e-9);
        else expect(now).toBeLessThanOrEqual(last + 1e-9);
        expect(lineAtHeight(leaf, from[1])).toBeLessThan(400);
        last = now;
      }
      expect(Math.abs(last - before)).toBeGreaterThan(0.03);
      expect(Math.abs(edgeGoneAt(leaf, from[1]) - (400 - at[0]))).toBeLessThan(1.5);
    }
    // Under the finger the corner it is peeled from is beside it: 40 from the corner, 210 gone.
    const low = setOff([220, 560]);
    wait(low.leaf, [220, 560], low.at, 40);
    expect(low.leaf.curled?.lean).toBeCloseTo(40 / 210, 3);
  });

  it('goes only to a finger it is short of: one already past its finger keeps its distance', () => {
    // In the air, its edge at 223; the finger comes down right of that and draws it on.
    const leaf = sheet(0.3);
    drag(leaf, [350, 300], [341, 300]);
    expect(leaf.shown).toBeCloseTo(0.3, 6);
    const taken = edgeGoneAt(leaf, 300);
    let last = taken;
    for (const x of [320, 320, 320, 300, 300, 280]) {
      drag(leaf, [350, 300], [x, 300]);
      const now = edgeGoneAt(leaf, 300);
      // Never back toward the finger, against the way the hand is going.
      expect(now).toBeGreaterThanOrEqual(last - 1e-6);
      expect(Math.abs(now - (taken + 341 - x))).toBeLessThan(0.6);
      last = now;
    }
    expect(leaf.curled?.held).toMatchObject({ setOff: true, coming: null });
    // A page gone from the frame is as gone in the frame it is taken in, and stays so.
    const gone = sheet(1);
    for (const x of [250, 200, 200, 200]) expect(drag(gone, [380, 300], [x, 300])).toBe(1);
  });

  it('taken in the air is where it was, whether or not it is lifted where the finger is', () => {
    for (const [shown, lean, y] of [
      [0.25, 0.5, 100],
      [0.02, 0.5, 300],
      [0.4, -0.3, 590],
      [0.6, 0, 300],
      [0.3, 0.3, 560],
      // Barely lifted: its edge still shows where it lay.
      [0.01, 0, 300],
    ] as const) {
      const leaf = sheet(shown, { ...curledFlat(), lean });
      const line = lineAt(page, shown, lean);
      // The finger has moved 180 px by the time it takes the page: none of that is the page's.
      const taken = drag(leaf, [380, y + 9], [200, y]);
      expect(taken).toBeCloseTo(shown, 5);
      expect(lineAt(page, taken, leaf.curled?.lean ?? 0).top).toBeCloseTo(line.top, 2);
      expect(lineAt(page, taken, leaf.curled?.lean ?? 0).bottom).toBeCloseTo(line.bottom, 2);
      // A hair's way on, a moment later, is a hair's difference; barely lifted, its line comes
      // in as fast as it does when a page first lifts, and no faster: a share of the roll's
      // radius, for the paper must round the roll before its edge shows coming in.
      const on = drag(leaf, [380, y + 9], [199, y], 1e-4);
      expect(Math.abs(on - taken) * 400).toBeLessThan(shown < 0.02 ? 0.7 * ROLL_RADIUS : 3);
      expect(on).toBeGreaterThanOrEqual(taken);
      // And whatever comes of it from there, it does not go back the way it came.
      let last = on;
      for (let count = 0; count < 12; count += 1) {
        const now = drag(leaf, [380, y + 9], [199, y]);
        expect(now).toBeGreaterThanOrEqual(last - 1e-9);
        last = now;
      }
    }
  });

  it('is taken anew by a finger that comes down again where the last one did, and by one that finds it left to itself', () => {
    const { leaf, at } = setOff();
    wait(leaf, [220, 300], at, 20);
    // Let go, it is on its own way; a finger comes down on the very point the last one did.
    release(leaf, 'returning', [220, 300], at);
    fly(leaf, 0.05);
    const flying = leaf.shown;
    expect(flying).toBeLessThan(0.4);
    expect(drag(leaf, [220, 300], [214, 300])).toBeCloseTo(flying, 5);
    expect(leaf.curled?.held?.setOff).toBe(false);
    // Left to itself while another page was the turn's, and taken up again by the same finger.
    const left = setOff();
    wait(left.leaf, [220, 300], left.at, 20);
    left.leaf.shown = 0.2;
    if (left.leaf.curled) left.leaf.curled.pace = null;
    expect(drag(left.leaf, [220, 300], left.at)).toBeCloseTo(0.2, 5);
  });
});

describe('a curled page its finger has let go', () => {
  /** A page held under a finger at 150, mid height, going at `speed` turns a second. */
  function heldAt(speed: number): Leaf {
    const leaf = sheet(0);
    drag(leaf, [220, 300], [200, 300]);
    drag(leaf, [220, 300], [150, 300]);
    wait(leaf, [220, 300], [150, 300], 20);
    leaf.speed = speed;
    return leaf;
  }

  /** Flies it to rest as the effect does; returns each place it was drawn at. */
  function flown(leaf: Leaf): number[] {
    const places: number[] = [];
    for (let count = 0; count < 120 && leaf.flight; count += 1) {
      const motion = leaf.flight.motion;
      const landed = fly(leaf, FRAME);
      places.push(leaf.shown);
      if (!landed) continue;
      // It is there while its own motion is still slowing down.
      expect(motion(leaf.flight.elapsed).done).toBe(false);
      leaf.flight = null;
    }
    return places;
  }

  it('finishes by itself from where it is, as fast as it was going, and is gone before its motion has stopped', () => {
    const leaf = heldAt(1.2);
    const held = leaf.shown;
    expect(held).toBeGreaterThan(0.35);
    // The frame it is let go in shows it where it was.
    expect(release(leaf, 'landing', [220, 300], [150, 300])).toBe(held);
    expect(leaf.flight?.to).toBe(1);
    expect(isThere(leaf)).toBe(false);
    const places = flown(leaf);
    // On at about the pace it had: the page 400 wide went 8 px of line a frame.
    expect((places[0] ?? 0) - held).toBeGreaterThan(0.6 * 1.2 * FRAME);
    expect((places[0] ?? 0) - held).toBeLessThan(3 * 1.2 * FRAME);
    places.reduce((before, now) => {
      expect(now).toBeGreaterThan(before);
      return now;
    }, held);
    expect(places.at(-1)).toBe(1);
    expect(places.length).toBeLessThan(16);
    // Its turn finds it there, and is over.
    expect(release(leaf, 'landing', [220, 300], [150, 300])).toBe(1);
    expect(leaf.flight).toBeNull();
    expect(isThere(leaf)).toBe(true);
  });

  it('sent back, lies flat again the same way', () => {
    const leaf = heldAt(-0.8);
    const held = leaf.shown;
    expect(release(leaf, 'returning', [220, 300], [150, 300])).toBe(held);
    expect(leaf.flight?.to).toBe(0);
    expect(leaf.speed).toBe(-0.8);
    const places = flown(leaf);
    places.reduce((before, now) => {
      expect(now).toBeLessThan(before);
      return now;
    }, held);
    expect(places.at(-1)).toBe(0);
    expect(places.length).toBeLessThan(16);
    expect(release(leaf, 'returning', [220, 300], [150, 300])).toBe(0);
    expect(isThere(leaf)).toBe(true);
  });

  it('starts from rest when it was going the other way: it was coming to the finger, not carried by the hand', () => {
    const leaf = heldAt(2.5);
    const held = leaf.shown;
    release(leaf, 'returning', [220, 300], [150, 300]);
    expect(leaf.speed).toBe(0);
    fly(leaf, FRAME);
    // It does not carry on over before it comes back.
    expect(leaf.shown).toBeLessThan(held);
  });

  it('is left to its own way by a turn that takes it the same way, and taken from it by one that does not', () => {
    const leaf = heldAt(1.2);
    release(leaf, 'landing', [220, 300], [150, 300]);
    fly(leaf, 0.03);
    const flying = leaf.shown;
    // A key turns the same page on: it is on its way there already.
    expect(
      placed(leaf, { ...fingered('landing', [0, 0], [0, 0]), touch: null }, forward(0.3), FRAME),
    ).toBe(flying);
    expect(leaf.flight?.elapsed).toBe(0.03);
    // A key turns it back: it keeps step with that turn from where it is.
    const back = { ...fingered('returning', [0, 0], [0, 0]), touch: null };
    expect(placed(leaf, back, forward(0.5), FRAME)).toBe(flying);
    expect(leaf.flight).toBeNull();
    expect(placed(leaf, back, forward(0.25), FRAME)).toBeCloseTo(flying / 2, 6);
    // Let go by a finger the other way while on its own way, it is sent off anew from there.
    const again = heldAt(1.2);
    release(again, 'landing', [220, 300], [150, 300]);
    fly(again, 0.03);
    const there = again.shown;
    expect(release(again, 'returning', [220, 300], [150, 300])).toBe(there);
    expect(again.flight).toMatchObject({ to: 0, elapsed: 0, from: there });
  });

  it('goes by itself in the same time whatever its frame is drawn at', () => {
    const plain = heldAt(0.4);
    release(plain, 'landing', [220, 300], [150, 300]);
    // The same page on a canvas of three pixels to each CSS one.
    const dense: Leaf = { ...sheet(plain.shown), shape: { spine: 0, width: 1200, height: 1800 } };
    dense.speed = 0.4;
    const fine = { width: 1200, height: 1800, spine: 0, cssPixel: 3 } as TransitionScene;
    const curled = dense.curled ?? curledFlat();
    const let3 = fingered('landing', [660, 900], [450, 900]);
    wantedCurled(dense, curled, fine, { ...let3, width: 1200 }, forward(0.1), FRAME);
    for (const seconds of [0.02, 0.08, 0.15, 0.3]) {
      const here = plain.flight?.motion(seconds);
      const there = dense.flight?.motion(seconds);
      expect(there?.x).toBeCloseTo(here?.x ?? Number.NaN, 9);
      expect(there?.done).toBe(here?.done);
    }
  });

  it('let go before any frame showed it held, turns from where it lies', () => {
    const leaf = sheet(0);
    expect(release(leaf, 'landing', [220, 300], [150, 300])).toBe(0);
    expect(leaf.flight?.to).toBe(1);
    expect(flown(leaf).at(-1)).toBe(1);
  });
});
