/**
 * The motion of a page turn as the web runs it, the engine built for the
 * browser (`crates/rito-turn`, bound as `RitoTurnMotion`): every number the
 * engine writes reaches the page under the name it means. Skipped on the
 * placeholder build, which has no engine.
 */
import { existsSync, readFileSync } from 'node:fs';

import { initRitoCoreWasmSync } from '@ritojs/core-wasm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  loadedTurnMotion,
  loadTurnMotion,
  type TurnMotion,
  type TurnMotionFactory,
  type TurnMotionPhysics,
} from '../../src/index';

const WASM = new URL('../../../rito-core-wasm/dist/rito_wasm_bg.wasm', import.meta.url);
const engineBuilt = existsSync(WASM) && readFileSync(WASM).byteLength > 1024;

const PHYSICS: TurnMotionPhysics = {
  stiffness: 180,
  damping: 27,
  swipeThreshold: 50,
  velocityCommit: 400,
  projection: 0.15,
  pullBack: 50,
  elasticFactor: 0.55,
};

let make: TurnMotionFactory;

function motion(): TurnMotion {
  const made = make(PHYSICS);
  made.configure(PHYSICS, 400);
  return made;
}

/** Steps until the turn is at rest; what the last step did. */
function settle(turn: TurnMotion): string {
  let step = 'moving';
  for (let frame = 0; frame < 600 && step === 'moving'; frame += 1) {
    step = turn.step(1 / 60);
  }
  return step;
}

describe.skipIf(!engineBuilt)('the engine’s turn motion on the page', () => {
  beforeAll(async () => {
    initRitoCoreWasmSync({ module: readFileSync(WASM) });
    make = await loadTurnMotion();
  });

  it('makes motions once loaded, as loadedTurnMotion says', () => {
    expect(loadedTurnMotion()).toBe(make);
  });

  it('turns the page a finger carries far enough, and lands on it', () => {
    const turn = motion();
    turn.startDrag(true, true, 0);
    for (let at = 1; at <= 5; at += 1) turn.drag(-12 * at, at);
    expect(turn.state).toMatchObject({
      phase: 'dragging',
      forward: true,
      hasIncoming: true,
      offset: -60,
      velocity: 0,
      showing: 'next',
      leaving: null,
    });
    expect(turn.state.fingerVelocity).toBeCloseTo(-12_000, 6);
    expect(turn.release()).toBe(true);
    expect(turn.state).toMatchObject({ phase: 'settling', target: -400, committing: true });
    expect(settle(turn)).toBe('committed');
    expect(turn.state).toMatchObject({ phase: 'idle', offset: -400 });
    turn.dispose();
  });

  it('takes the host’s answers where its physics decide', () => {
    const turn = motion();
    turn.startDrag(true, false, 0);
    turn.dragCarried(-30, 16);
    expect(turn.state.offset).toBe(-30);
    expect(turn.release(true)).toBe(false);
    expect(turn.state.showing).toBeNull();
    expect(settle(turn)).toBe('cancelled');
    turn.dispose();
  });

  it('carries on what a turn cut into leaves, and begins the next where the host says', () => {
    const turn = motion();
    turn.turn(true);
    for (let frame = 0; frame < 6; frame += 1) turn.step(1 / 60);
    const offset = turn.state.offset;
    turn.carryOn(true);
    expect(turn.state).toMatchObject({ phase: 'finishing', leaving: 'prev', showing: 'prev' });
    expect(turn.state.offset).toBeCloseTo(offset + 400, 9);
    turn.turn(true, { offset: 0, velocity: 0 });
    expect(turn.state).toMatchObject({ offset: 0, leaving: null, showing: 'next' });
    turn.dispose();
  });

  it('is carried by the host’s own motion when it passes where that is', () => {
    const turn = motion();
    turn.turn(false);
    expect(turn.state.settle).toEqual({ generation: 1, from: 0, velocity: 0, to: 400 });
    expect(turn.step(0.25, { x: 100, velocity: 400, done: false })).toBe('moving');
    expect(turn.state.offset).toBe(100);
    expect(turn.step(0.75, { x: 400, velocity: 0, done: true })).toBe('committed');
    expect(turn.state).toMatchObject({ phase: 'idle', offset: 400 });
    turn.dispose();
  });

  it('lets a finger take a turn in flight, and a cut leaves its shift', () => {
    const turn = motion();
    turn.turn(true);
    turn.step(1 / 60);
    expect(turn.interrupt(10)).toBe(true);
    expect(turn.state.phase).toBe('dragging');
    expect(turn.cancel()).toBe(true);
    expect(turn.state).toMatchObject({ phase: 'settling', target: 0 });
    turn.reset();
    expect(turn.state).toMatchObject({ phase: 'idle', offset: 0 });
    turn.turn(true);
    turn.step(0.05);
    turn.carryOn(true);
    expect(turn.state.shift).toBe(400);
    turn.finish();
    expect(turn.state.phase).toBe('idle');
    turn.dispose();
  });
});
