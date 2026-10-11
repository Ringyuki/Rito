import { describe, expect, it } from 'vitest';
import type { TransitionSettle } from '../src/driver/physics';
import { curledFlat } from '../src/driver/paper/curled';
import { holdOf, NEAREST_HOLD, swungTo, type View } from '../src/driver/paper/hold';
import { layLeaf, leafPoint, poseAt, type LeafShape } from '../src/driver/paper/leaf';
import {
  fly,
  GONE_BY,
  hasLanded,
  inTheAir,
  keepInOrder,
  leaveAlone,
  placeInBook,
  sendOff,
  type Leaf,
} from '../src/driver/paper/leaves';

const COLUMNS = 16;
const ROWS = 12;
const two: LeafShape = { spine: 400, width: 400, height: 600 };
const one: LeafShape = { spine: 0, width: 400, height: 600 };
const view: View = { width: 800, height: 600, eye: 1920 };

function leaf(spread: number, shown: number, shape: LeafShape = two): Leaf {
  return {
    spread,
    printed: { spread },
    shape,
    curled: shape.spine === 0 ? curledFlat() : null,
    grab: { u: 1, v: 0.86 },
    hold: null,
    heldFrom: null,
    shown,
    speed: 0,
    letGo: null,
    front: null,
    after: null,
    flight: null,
    positions: new Float32Array(COLUMNS * ROWS * 3),
    normals: new Float32Array(COLUMNS * ROWS * 3),
  };
}

/** A leaf nothing holds goes evenly, a whole motion a second. */
const evenly = (from: number, _speed: number, to: number): TransitionSettle => {
  return (seconds) => {
    const gone = Math.min(Math.abs(to - from), seconds);
    return {
      x: from + Math.sign(to - from) * gone,
      velocity: to - from,
      done: gone >= Math.abs(to - from),
    };
  };
};

function seenAcross(x: number, z: number): number {
  return view.width / 2 + ((x - view.width / 2) * view.eye) / (view.eye - z);
}

describe('the leaves in the air', () => {
  it('come in the order of the spreads printed on them', () => {
    const book: Leaf[] = [];
    for (const spread of [12, 10, 13, 11]) placeInBook(book, leaf(spread, 0.5));
    expect(book.map((placed) => placed.spread)).toEqual([10, 11, 12, 13]);
  });

  it('are left to come down on the side of the leaf being turned they belong on', () => {
    const book = [leaf(10, 0.7), leaf(11, 0.4), leaf(12, 0.2)];
    const led = book[1] as Leaf;
    leaveAlone(book, led, evenly);
    // The one before it has been turned and lands left; the one after has not and goes back.
    expect(book.map((left) => left.flight?.to)).toEqual([1, undefined, 0]);
    for (const left of book) fly(left, 0.1);
    expect(book.map((left) => Number(left.shown.toFixed(3)))).toEqual([0.8, 0.4, 0.1]);
  });

  it('never pass through each other: the leaf being turned takes along what it would pass', () => {
    const book = [leaf(10, 0.6), leaf(11, 0.9), leaf(12, 0.95)];
    keepInOrder(book, book[1] as Leaf);
    expect(book.map((kept) => kept.shown)).toEqual([0.9, 0.9, 0.9]);

    const lower = [leaf(10, 0.1), leaf(11, 0.3), leaf(12, 0.2)];
    keepInOrder(lower, lower[0] as Leaf);
    expect(lower.map((kept) => kept.shown)).toEqual([0.1, 0.1, 0.1]);
  });

  it('have landed a pixel short of flat, not when a spring has crept the rest', () => {
    const settling = leaf(10, 0.5);
    // Never done by its own account, and slowing as it nears.
    sendOff(settling, 1, (from, _speed, to) => (seconds) => ({
      x: to - (to - from) * Math.exp(-20 * seconds),
      velocity: 20 * (to - from) * Math.exp(-20 * seconds),
      done: false,
    }));
    expect(fly(settling, 0.2)).toBe(false);
    expect(inTheAir(settling)).toBe(true);
    expect(fly(settling, 0.4)).toBe(true);
    expect(settling.shown).toBe(1);
    expect(hasLanded(settling)).toBe(true);
  });

  it('a page curled over has left the frame while its motion is still going', () => {
    const leaving = leaf(10, 0.2, one);
    sendOff(leaving, 1, evenly);
    // Half of its own way on, it is well over half of the way out.
    expect(fly(leaving, 0.4)).toBe(false);
    expect(leaving.shown).toBeCloseTo(0.2 + 0.4 / GONE_BY, 6);
    // It is out once its motion has gone that share of the way, and then it has landed.
    expect(fly(leaving, 0.8 * GONE_BY - 0.4 + 0.001)).toBe(true);
    expect(leaving.shown).toBe(1);
    expect(hasLanded(leaving)).toBe(true);

    // Coming back to lie flat it arrives with its motion, as a leaf does.
    const returning = leaf(11, 0.6, one);
    sendOff(returning, 0, evenly);
    expect(fly(returning, 0.3)).toBe(false);
    expect(returning.shown).toBeCloseTo(0.3, 6);
    // A leaf of two pages is never hurried out.
    const swung = leaf(12, 0.2);
    sendOff(swung, 1, evenly);
    fly(swung, 0.4);
    expect(swung.shown).toBeCloseTo(0.6, 6);
  });
});

describe('the hold a finger takes of a leaf in the air', () => {
  const laid = (shown: number): Leaf => {
    const turned = leaf(10, shown);
    layLeaf(two, poseAt(two, turned.grab, shown), COLUMNS, ROWS, turned.positions, turned.normals);
    return turned;
  };

  it('is of the point of the leaf showing under the finger', () => {
    const turned = laid(0.35);
    const u = 12 / (COLUMNS - 1);
    const v = 7 / (ROWS - 1);
    const [x, y, z] = leafPoint(two, poseAt(two, turned.grab, 0.35), u * two.width, v * two.height);
    const finger = {
      x: seenAcross(x, z),
      y: view.height / 2 + ((y - view.height / 2) * view.eye) / (view.eye - z),
    };
    const hold = holdOf(turned.positions, COLUMNS, ROWS, view, finger);
    expect(hold.u).toBeCloseTo(u, 6);
    expect(hold.v).toBeCloseTo(v, 6);
    expect(hold.offset).toBeCloseTo(0, 3);
  });

  it('is no nearer the spine than a hand turns a leaf by, and keeps its distance from the finger', () => {
    const turned = laid(0.35);
    const hold = holdOf(turned.positions, COLUMNS, ROWS, view, { x: 395, y: 300 });
    expect(hold.u).toBeGreaterThanOrEqual(NEAREST_HOLD);
    expect(Math.abs(hold.offset)).toBeGreaterThan(1);
  });

  it('leaves the leaf where it is when the finger has not moved, and follows it when it has', () => {
    for (const shown of [0.15, 0.4, 0.62, 0.85]) {
      const turned = laid(shown);
      const finger = { x: 380, y: 420 };
      const hold = holdOf(turned.positions, COLUMNS, ROWS, view, finger);
      expect(swungTo(two, turned.grab, hold, view, finger.x, 1)).toBeCloseTo(shown, 3);
      // Toward the right the leaf comes back, toward the left it goes on over.
      expect(swungTo(two, turned.grab, hold, view, finger.x + 40, 1)).toBeLessThan(shown);
      expect(swungTo(two, turned.grab, hold, view, finger.x - 40, 1)).toBeGreaterThan(shown);
    }
  });
});
