/**
 * The engine's page turns of a reader as the web runs them
 * (`crates/rito-turn`'s controller, bound as `RitoTurnController`): every
 * action, question and frame the engine decides reaches the host under the
 * name it means, and every answer and event the host gives reaches the
 * engine. Skipped on the placeholder build, which has no engine.
 */
import { existsSync, readFileSync } from 'node:fs';

import { initRitoCoreWasmSync } from '@ritojs/core-wasm';
import { beforeAll, describe, expect, it } from 'vitest';

import {
  loadedTurnController,
  loadTurnMotion,
  type TurnAction,
  type TurnController,
  type TurnMotionPhysics,
  type TurnPages,
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

const BOTH = { next: true, previous: true };
const READY: TurnPages = { canTurn: BOTH, there: BOTH, drawable: BOTH, beyond: BOTH };
/** The pages, the next one not painted yet. */
const NEXT_AWAY: TurnPages = { ...READY, there: { next: false, previous: true } };
/** The pages, the effect not yet able to draw either. */
const UNDRAWABLE: TurnPages = { ...READY, drawable: { next: false, previous: false } };

const opened: TurnController[] = [];

function turns(): TurnController {
  const make = loadedTurnController();
  if (!make) throw new Error('no controller once the engine is loaded');
  const made = make(PHYSICS);
  made.configure(PHYSICS, 400, false);
  opened.push(made);
  return made;
}

/** Every action waiting, in order. */
function actions(controller: TurnController): TurnAction[] {
  const taken: TurnAction[] = [];
  for (let action = controller.takeAction(); action; action = controller.takeAction()) {
    taken.push(action);
  }
  return taken;
}

/** Frames until nothing moves; the actions they bring. */
function settle(controller: TurnController, pages: TurnPages = READY): TurnAction[] {
  const taken: TurnAction[] = [];
  for (let frame = 0; frame < 240 && controller.state.moving; frame += 1) {
    controller.step(pages, 1 / 60);
    taken.push(...actions(controller));
  }
  return taken;
}

describe.skipIf(!engineBuilt)('the engine’s page turns, every word of them', () => {
  beforeAll(async () => {
    initRitoCoreWasmSync({ module: readFileSync(WASM) });
    await loadTurnMotion();
    return () => {
      for (const controller of opened) controller.dispose();
    };
  });

  it('says where a finger holding the page took hold, is and carried it farthest', () => {
    const controller = turns();
    controller.fingerDown(READY, 300, 200, 0);
    controller.fingerMove(READY, 220, 205, -80, undefined, 16);
    controller.fingerMove(READY, 240, 210, -60, undefined, 32);
    expect(actions(controller)).toEqual([{ kind: 'started', direction: 'next' }]);
    expect(controller.state).toMatchObject({ turning: 'next', held: true, request: null });
    expect(controller.state.frame).toEqual({
      offset: -60,
      incoming: 'next',
      phase: 'held',
      velocity: 0,
      touch: {
        origin: { x: 300, y: 200 },
        position: { x: 240, y: 210 },
        farthest: { x: 220, y: 205 },
      },
    });
    controller.fingerCancel(READY);
    expect(settle(controller)).toEqual([
      { kind: 'ended', direction: 'next', outcome: 'cancelled', carries: false },
    ]);
    expect(controller.state.frame).toBeNull();
  });

  it('turns back toward the page before, its picture coming in from the other side', () => {
    const controller = turns();
    expect(controller.command(READY, 'previous')).toBe(true);
    expect(actions(controller)).toEqual([
      { kind: 'started', direction: 'previous' },
      { kind: 'land', direction: 'previous' },
    ]);
    controller.landed(READY, true);
    controller.step(READY, 1 / 60);
    expect(controller.state.turning).toBe('previous');
    expect(controller.state.frame).toMatchObject({ incoming: 'prev', phase: 'landing' });
    expect(controller.state.frame?.offset).toBeGreaterThan(0);
  });

  it('asks for a page not painted yet, and begins once told it is', () => {
    const controller = turns();
    expect(controller.command(NEXT_AWAY, 'next')).toBe(true);
    expect(actions(controller)).toEqual([{ kind: 'fetch', direction: 'next' }]);
    expect(controller.state.turning).toBeNull();
    controller.pages(READY);
    expect(actions(controller).map((action) => action.kind)).toEqual(['started', 'land']);
  });

  it('waits for an effect that cannot draw the page yet, only so long', () => {
    const controller = turns();
    controller.command(UNDRAWABLE, 'next');
    expect(actions(controller)).toEqual([{ kind: 'wait-for-effect', seconds: 0.5 }]);
    controller.overdue(UNDRAWABLE);
    expect(actions(controller).map((action) => action.kind)).toEqual(['started', 'land']);
  });

  it('asks where a turn that cuts into another begins, and goes by the answer or its own rule', () => {
    for (const answer of [{ offset: 0, velocity: 0 }, undefined]) {
      const controller = turns();
      controller.command(READY, 'next');
      actions(controller);
      controller.landed(READY, true);
      for (let frame = 0; frame < 6; frame += 1) controller.step(READY, 1 / 60);
      controller.command(READY, 'next');
      // The first turn ends, carrying its picture on; the next begins, and asks where.
      expect(actions(controller)).toEqual([
        { kind: 'ended', direction: 'next', outcome: 'committed', carries: true },
        { kind: 'started', direction: 'next' },
      ]);
      const asked = controller.state.request;
      expect(asked).toMatchObject({ kind: 'begin', forward: true, hasIncoming: true });
      expect(asked?.kind === 'begin' && asked.leftover.leaving).toBe('prev');
      expect(asked?.kind === 'begin' && asked.leftover.offset).toBeGreaterThan(0);
      controller.answerBegin(answer);
      expect(controller.state.request).toBeNull();
      expect(actions(controller)).toEqual([{ kind: 'land', direction: 'next' }]);
      if (answer) expect(controller.state.frame?.offset).toBe(0);
      else expect(controller.state.frame?.offset).toBeGreaterThan(0);
    }
  });

  it('lets what a cut turn left come to rest when the turn after it waits, and says so', () => {
    const controller = turns();
    controller.command(READY, 'next');
    actions(controller);
    controller.landed(READY, true);
    for (let frame = 0; frame < 6; frame += 1) controller.step(READY, 1 / 60);
    controller.command(NEXT_AWAY, 'next');
    expect(actions(controller).map((action) => action.kind)).toEqual(['ended', 'fetch']);
    expect(settle(controller, NEXT_AWAY)).toEqual([{ kind: 'rested' }]);
  });

  it('sends a release back when the host’s physics say it does not land', () => {
    const controller = turns();
    controller.fingerDown(READY, 300, 200, 0);
    controller.fingerMove(READY, 100, 200, -200, undefined, 16);
    expect(actions(controller)).toEqual([{ kind: 'started', direction: 'next' }]);
    controller.fingerUp(READY, 100, 200, -200, 32);
    expect(controller.state.request).toMatchObject({
      kind: 'lands',
      release: { offset: -200, from: 0, width: 400, forward: true },
    });
    controller.answerLands(false);
    expect(settle(controller)).toEqual([
      { kind: 'ended', direction: 'next', outcome: 'cancelled', carries: false },
    ]);
  });

  it('decides a release by its own rule when the host gives no answer', () => {
    const controller = turns();
    controller.fingerDown(READY, 300, 200, 0);
    controller.fingerMove(READY, 100, 200, -200, undefined, 16);
    controller.fingerUp(READY, 100, 200, -200, 32);
    controller.answerLands(undefined);
    expect(actions(controller)).toEqual([
      { kind: 'started', direction: 'next' },
      { kind: 'land', direction: 'next' },
    ]);
  });

  it('moves a turn the host’s own motion carries where that motion says', () => {
    const controller = turns();
    controller.command(READY, 'next');
    actions(controller);
    controller.landed(READY, true);
    controller.step(READY, 1 / 60, { x: -123, velocity: -50, done: false });
    expect(controller.state.frame?.offset).toBe(-123);
    controller.step(READY, 1 / 60, { x: -400, velocity: 0, done: true });
    expect(actions(controller)).toEqual([
      { kind: 'ended', direction: 'next', outcome: 'committed', carries: false },
    ]);
  });

  it('ends what is on screen interrupted, or at once where it was going', () => {
    const interrupted = turns();
    interrupted.command(READY, 'next');
    actions(interrupted);
    interrupted.interrupt();
    expect(actions(interrupted)).toEqual([
      { kind: 'ended', direction: 'next', outcome: 'interrupted', carries: false },
    ]);
    expect(interrupted.state.moving).toBe(false);

    const landed = turns();
    landed.command(READY, 'next');
    actions(landed);
    landed.landed(READY, true);
    landed.settleNow();
    expect(actions(landed)).toEqual([
      { kind: 'ended', direction: 'next', outcome: 'committed', carries: false },
    ]);
  });

  it('plays a jump the reader made as a turn from the page it left, once the effect can draw it', () => {
    const controller = turns();
    controller.playJump(UNDRAWABLE, 'previous');
    expect(actions(controller)).toEqual([
      { kind: 'started', direction: 'previous' },
      { kind: 'wait-for-effect', seconds: 0.5 },
    ]);
    expect(controller.state.frame?.offset ?? 0).toBe(0);
    controller.pages(READY);
    expect(settle(controller)).toEqual([
      { kind: 'ended', direction: 'previous', outcome: 'committed', carries: false },
    ]);
  });
});
