import { describe, expect, it, vi } from 'vitest';
import { wireUnifiedTouchHandler, type GestureDeps } from '../src/controller/wiring/gesture';
import type { InteractionModeManager } from '../src/controller/interaction-mode/index';
import {
  transitionEffects,
  type LayeredTransitionEffect,
  type TransitionTouch,
} from '../src/driver/effects';
import type { FrameDriver } from '../src/driver/frame-driver';
import { travelOf, type TransitionPhysics } from '../src/driver/physics';
import { createTransitionDriver, type TransitionDriver } from '../src/driver/transition-driver';
import type { TransitionDriverOptions } from '../src/driver/types';
import { createDisposableCollection } from '../src/utils/disposable';
import { createSelectionHarness } from './helpers/dom-input';

const WIDTH = 800;
const finger: TransitionTouch = { origin: { x: 300, y: 500 }, position: { x: 180, y: 420 } };

interface Driven {
  readonly td: TransitionDriver;
  readonly ended: string[];
}

/** A driver over pages on either side, painted, its turns landed as the kit lands them. */
function driver(options?: Partial<TransitionDriverOptions>, canTurn = true): Driven {
  const td = createTransitionDriver(options);
  td.viewportWidth = WIDTH;
  const ended: string[] = [];
  td.pagesFrom(() => ({
    canTurn: { next: canTurn, previous: canTurn },
    there: { next: true, previous: true },
    drawable: { next: true, previous: true },
    beyond: { next: canTurn, previous: canTurn },
  }));
  td.onAction((action) => {
    if (action.kind === 'land') td.landed(true);
    if (action.kind === 'ended') ended.push(`${action.direction}:${action.outcome}`);
  });
  return { td, ended };
}

/** A finger moving `travel` px over a second, so slowly its speed says nothing. */
function slowDrag(td: TransitionDriver, travel: number, touch: TransitionTouch): number {
  td.fingerDown(touch.origin, 0);
  const steps = 10;
  for (let step = 1; step <= steps; step += 1) {
    td.fingerMove(touch.position, (travel * step) / steps, step * 100);
  }
  return steps * 100;
}

/** A second at constant speed. */
const steady: NonNullable<TransitionPhysics['settle']> = (from, _velocity, to) => (seconds) => ({
  x: from + (to - from) * Math.min(1, seconds),
  velocity: to - from,
  done: seconds >= 1,
});

describe('what a frame says about its turn', () => {
  it('a held turn reports the finger, a released one where it let go and how fast it moves', () => {
    const { td } = driver();
    td.fingerDown(finger.origin, 0);
    td.fingerMove(finger.position, -120, 16);
    expect(td.step(16)).toMatchObject({ dx: -120, phase: 'held', velocity: 0, touch: finger });

    const lifted = { origin: finger.origin, position: { x: 100, y: 400 } };
    td.fingerMove(lifted.position, -200, 32);
    td.fingerUp(lifted.position, -200, 32);
    expect(td.mode.kind).toBe('settling');
    const landing = td.step(16);
    expect(landing).toMatchObject({ phase: 'landing', touch: lifted });
    expect(landing.kind === 'turning' ? landing.velocity : 0).toBeLessThan(0);
  });

  it('a turn going back, a turn no finger held and a pull at the end of the book', () => {
    const back = driver().td;
    const time = slowDrag(back, -20, finger);
    back.fingerUp(finger.position, -20, time + 100);
    expect(back.step(16)).toMatchObject({ phase: 'returning', touch: finger });

    const key = driver().td;
    key.command('next');
    expect(key.step(16)).toMatchObject({ phase: 'landing', touch: null });

    const end = driver(undefined, false).td;
    end.fingerDown(finger.origin, 0);
    end.fingerMove(finger.position, -100, 100);
    end.fingerUp(finger.position, -100, 100);
    expect(end.step(16)).toMatchObject({ incoming: null, phase: 'returning', touch: finger });
  });
});

describe('physics an application writes', () => {
  it('decide a release the built-in rule would send back, and carry the turn their own way', () => {
    const { td, ended } = driver({
      physics: { lands: ({ dx, width }) => Math.abs(dx) > width / 4, settle: steady },
    });
    td.fingerDown(finger.origin, 0);
    // The finger is pulling back as it lets go.
    td.fingerMove(finger.position, -400, 10);
    td.fingerMove(finger.position, -300, 20);
    td.fingerMove(finger.position, -250, 30);
    td.fingerUp(finger.position, -250, 30);
    expect(td.mode).toMatchObject({ kind: 'settling', target: -WIDTH });

    for (let frame = 0; frame < 25; frame += 1) td.step(16);
    expect(td.mode).toMatchObject({ kind: 'settling', vx: -550 });
    expect(td.mode.kind === 'settling' ? td.mode.dx : 0).toBeCloseTo(-250 - 550 * 0.4, 6);
    // The turn is over when their motion says so: at one second, not before.
    for (let frame = 25; frame < 62; frame += 1) td.step(16);
    expect(ended).toEqual([]);
    td.step(16);
    expect(ended).toEqual(['next:committed']);
    expect(td.mode.kind).toBe('idle');
  });

  it('are told of the finger, and of where the pages are bound, when a turn is let go', () => {
    const lands = vi.fn(() => true);
    const { td } = driver({ physics: { lands } });
    td.spine = 0;
    const origin = { x: 300, y: 200 };
    td.fingerDown(origin, 0);
    td.fingerMove({ x: 200, y: 205 }, -100, 16);
    td.fingerMove({ x: 240, y: 210 }, -60, 32);
    td.fingerUp({ x: 240, y: 210 }, -60, 32);
    const touch = { origin, position: { x: 240, y: 210 }, farthest: { x: 200, y: 205 } };
    expect(lands).toHaveBeenCalledWith(
      expect.objectContaining({ dx: -60, from: 0, direction: 'forward', touch, spine: 0 }),
    );
    td.interrupt();
    td.spine = 640;
    td.fingerDown(origin, 100);
    td.fingerMove({ x: 240, y: 210 }, -60, 116);
    td.fingerUp({ x: 240, y: 210 }, -60, 116);
    expect(lands).toHaveBeenLastCalledWith(expect.objectContaining({ spine: 640 }));
  });

  it('say where a pull against the end of the book leaves the page', () => {
    const { td } = driver({ physics: { resist: (travel) => travel / 10 } }, false);
    td.fingerDown(finger.origin, 0);
    td.fingerMove(finger.position, -100, 16);
    expect(td.mode).toMatchObject({ kind: 'tracking', dx: -10 });
  });

  it('come with an effect, yield to the options and leave with the effect', () => {
    const effect: LayeredTransitionEffect = {
      layers: (frame) => transitionEffects.slide.layers(frame),
      physics: { lands: () => true },
    };
    let time = 0;
    const nudge = (td: TransitionDriver): 'commit' | 'cancel' => {
      td.interrupt();
      time += 1000;
      td.fingerDown(finger.origin, time);
      td.fingerMove(finger.position, -1, time);
      td.fingerMove(finger.position, -2, time + 400);
      td.fingerMove(finger.position, -2, time + 800);
      td.fingerMove(finger.position, -2, time + 1200);
      td.fingerMove(finger.position, -2, time + 1600);
      td.fingerMove(finger.position, -2, time + 2000);
      td.fingerUp(finger.position, -2, time + 2000);
      return td.mode.kind === 'settling' && td.mode.target !== 0 ? 'commit' : 'cancel';
    };
    const { td } = driver({ effect });
    expect(td.physics).toBe(effect.physics);
    expect(nudge(td)).toBe('commit');

    td.configure({ physics: { lands: () => false } });
    expect(nudge(td)).toBe('cancel');

    // Reduced motion swaps the effect for a cross-fade, and its physics go with it.
    td.configure({ physics: undefined });
    td.reducedMotion = true;
    expect(td.physics).toBeUndefined();
    expect(nudge(td)).toBe('cancel');
  });

  it('read the finger their own way, told the viewport', () => {
    const bounds = { width: WIDTH, spine: 400 };
    expect(travelOf(undefined, finger, bounds)).toBe(-120);
    const travel = vi.fn((touch: TransitionTouch) => touch.position.y - touch.origin.y);
    expect(travelOf({ travel }, finger, bounds)).toBe(-80);
    expect(travel).toHaveBeenCalledWith(finger, bounds);
  });
});

describe('a touch on the reader', () => {
  it('reaches the turn as the canvas sees it, carried as far as the physics say', () => {
    const listeners = new Map<string, (event: unknown) => void>();
    const target = {
      addEventListener: (type: string, listener: (event: unknown) => void) => {
        listeners.set(type, listener);
      },
      removeEventListener: () => undefined,
      getBoundingClientRect: () => ({ left: 30, top: 50 }),
    } as unknown as HTMLElement;
    // Turns pages under a vertical drag. One spread: every drag pulls
    // against the end of the book.
    const { td } = driver(
      { physics: { travel: (touch) => touch.position.y - touch.origin.y } },
      false,
    );
    td.spine = 400;
    const deps: GestureDeps = {
      td,
      frameDriver: { scheduleComposite: vi.fn() } as unknown as FrameDriver,
      claimForFinger: vi.fn(),
    };
    const modes = { mode: 'gesture', setMode: vi.fn(), onModeChange: () => () => undefined };
    const disposables = createDisposableCollection();
    wireUnifiedTouchHandler(
      target,
      deps,
      createSelectionHarness().engine,
      modes as unknown as InteractionModeManager,
      (touch) => ({ x: touch.clientX, y: touch.clientY }),
      vi.fn(),
      disposables,
    );
    const emit = (type: string, clientX: number, clientY: number, timeStamp: number): void => {
      const touch = { identifier: 1, clientX, clientY };
      listeners.get(type)?.({
        changedTouches: [touch],
        touches: [touch],
        timeStamp,
        cancelable: false,
      });
    };

    emit('touchstart', 330, 550, 0);
    emit('touchmove', 330, 450, 16);
    expect(td.mode).toMatchObject({
      kind: 'tracking',
      direction: 'forward',
      touch: { origin: { x: 300, y: 500 }, position: { x: 300, y: 400 } },
    });
    // A sideways move is no travel to these physics.
    const held = td.mode.kind === 'tracking' ? td.mode.dx : 0;
    emit('touchmove', 130, 450, 32);
    expect(td.mode).toMatchObject({ dx: held, touch: { position: { x: 100, y: 400 } } });
    disposables.disposeAll();
  });
});
