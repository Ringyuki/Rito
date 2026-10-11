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

function driver(options?: Partial<TransitionDriverOptions>): TransitionDriver {
  const td = createTransitionDriver(options);
  td.viewportWidth = WIDTH;
  return td;
}

/** A second at constant speed. */
const steady: NonNullable<TransitionPhysics['settle']> = (from, _velocity, to) => (seconds) => ({
  x: from + (to - from) * Math.min(1, seconds),
  velocity: to - from,
  done: seconds >= 1,
});

describe('what a frame says about its turn', () => {
  it('a held turn reports the finger, a released one where it let go and how fast it moves', () => {
    const td = driver();
    td.startTracking('forward', 0, 1, 0);
    td.updateTracking(-120, 16, finger);
    expect(td.step(16)).toMatchObject({ dx: -120, phase: 'held', velocity: 0, touch: finger });

    const lifted = { origin: finger.origin, position: { x: 100, y: 400 } };
    td.updateTracking(-200, 32, lifted);
    expect(td.releaseTracking()).toBe('commit');
    const landing = td.step(16);
    expect(landing).toMatchObject({ phase: 'landing', touch: lifted });
    expect(landing.kind === 'turning' ? landing.velocity : 0).toBeLessThan(0);
  });

  it('a turn going back, a turn no finger held and a pull at the end of the book', () => {
    const back = driver();
    back.startTracking('forward', 0, 1, 0);
    back.updateTracking(-20, 100, finger);
    expect(back.releaseTracking()).toBe('cancel');
    expect(back.step(16)).toMatchObject({ phase: 'returning', touch: finger });

    const key = driver();
    key.goToTarget('forward', 0, 1);
    expect(key.step(16)).toMatchObject({ phase: 'landing', touch: null });

    const end = driver();
    end.startTracking('forward', 0, null, 0);
    end.updateTracking(-100, 100, finger);
    end.releaseTracking();
    expect(end.step(16)).toMatchObject({ incoming: null, phase: 'returning', touch: finger });
  });
});

describe('physics an application writes', () => {
  it('decide a release the built-in rule would send back, and carry the turn their own way', () => {
    const td = driver({
      physics: { lands: ({ dx, width }) => Math.abs(dx) > width / 4, settle: steady },
    });
    const settled = vi.fn();
    td.onSettled(settled);
    td.startTracking('forward', 0, 1, 0);
    // The finger is pulling back as it lets go.
    td.updateTracking(-400, 10);
    td.updateTracking(-300, 20);
    td.updateTracking(-250, 30);
    expect(td.releaseTracking()).toBe('commit');

    for (let frame = 0; frame < 25; frame += 1) td.step(16);
    expect(td.mode).toMatchObject({ kind: 'settling', vx: -550 });
    expect(td.mode.kind === 'settling' ? td.mode.dx : 0).toBeCloseTo(-250 - 550 * 0.4, 6);
    // The turn is over when their motion says so: at one second, not before.
    for (let frame = 25; frame < 62; frame += 1) td.step(16);
    expect(settled).not.toHaveBeenCalled();
    td.step(16);
    expect(settled).toHaveBeenCalledWith({
      direction: 'forward',
      committed: true,
      targetSpread: 1,
    });
    expect(td.mode.kind).toBe('idle');
  });

  it('say where a pull against the end of the book leaves the page', () => {
    const td = driver({ physics: { resist: (travel) => travel / 10 } });
    td.startTracking('forward', 0, null, 0);
    td.updateTracking(-100, 16);
    expect(td.mode).toMatchObject({ kind: 'tracking', dx: -10 });
  });

  it('come with an effect, yield to the options and leave with the effect', () => {
    const effect: LayeredTransitionEffect = {
      layers: (frame) => transitionEffects.slide.layers(frame),
      physics: { lands: () => true },
    };
    const nudge = (td: TransitionDriver): 'commit' | 'cancel' => {
      td.reset();
      td.startTracking('forward', 0, 1, 0);
      td.updateTracking(-2, 400);
      return td.releaseTracking();
    };
    const td = driver({ effect });
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
    // Turns pages under a vertical drag.
    const td = driver({
      physics: { travel: (touch) => touch.position.y - touch.origin.y },
    });
    td.spine = 400;
    const deps: GestureDeps = {
      td,
      frameDriver: { scheduleComposite: vi.fn() } as unknown as FrameDriver,
      startGestureNavigation: vi.fn(() => ({ cancel: vi.fn() })),
      getCurrentSpread: () => 0,
      // One spread: every drag pulls against the end of the book.
      getTotalSpreads: () => 1,
      commitPendingTransition: vi.fn(),
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
