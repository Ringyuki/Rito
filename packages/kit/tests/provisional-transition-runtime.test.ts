import type { Reader } from '@ritojs/core';
import { describe, expect, it, vi } from 'vitest';
import type { Internals } from '../src/controller/core/internals';
import {
  createProvisionalTransitionRuntime,
  type ProvisionalTransitionRuntime,
} from '../src/controller/runtime-frame';
import type { ReaderControllerEvents } from '../src/controller/types';
import type { PrerenderScheduler } from '../src/controller/prerender';
import type { FrameDriver } from '../src/driver/frame-driver';
import type { ContentRenderer, PageBufferPool } from '../src/painter/buffer-pool';
import { createEmitter } from '../src/utils/event-emitter';

describe('provisional transition runtime', () => {
  it('ends the visible transition without releasing exact ownership', () => {
    const scenario = createScenario();
    scenario.runtime.begin('forward');

    scenario.runtime.visualSettled('forward');
    scenario.runtime.visualSettled('forward');

    expect(scenario.events).toEqual(['end:forward']);
    expect(scenario.pausePrerender).toHaveBeenCalledTimes(1);
    expect(scenario.resumePrerender).not.toHaveBeenCalled();
    expect(scenario.schedulePrerender).not.toHaveBeenCalled();
    expect(scenario.compositeNow).toHaveBeenCalledTimes(1);

    scenario.runtime.complete('forward');

    expect(scenario.events).toEqual(['end:forward']);
    expect(scenario.resumePrerender).toHaveBeenCalledTimes(1);
    expect(scenario.schedulePrerender).toHaveBeenCalledTimes(1);
    expect(scenario.compositeNow).toHaveBeenCalledTimes(2);
  });

  it('reopens a rollback visual pair while preserving the original owner direction', () => {
    const scenario = createScenario();
    scenario.runtime.begin('forward');
    scenario.runtime.visualSettled('forward');

    expect(scenario.runtime.reopenVisual('backward', 'backward')).toBe(false);
    expect(scenario.runtime.reopenVisual('forward', 'backward')).toBe(true);
    scenario.runtime.complete('backward');
    expect(scenario.resumePrerender).not.toHaveBeenCalled();

    scenario.runtime.complete('forward');

    expect(scenario.events).toEqual(['end:forward', 'end:backward']);
    expect(scenario.resumePrerender).toHaveBeenCalledTimes(1);
  });

  it('defers exact completion after visual settle without emitting a duplicate end', () => {
    const scenario = createScenario();
    scenario.runtime.begin('forward');
    scenario.runtime.visualSettled('forward');

    const finish = scenario.runtime.deferForLayout('forward');
    expect(finish).toBeTypeOf('function');
    expect(scenario.resumePrerender).not.toHaveBeenCalled();
    expect(scenario.schedulePrerender).not.toHaveBeenCalled();

    finish?.();
    finish?.();

    expect(scenario.events).toEqual(['end:forward']);
    expect(scenario.resumePrerender).toHaveBeenCalledTimes(1);
    expect(scenario.schedulePrerender).toHaveBeenCalledTimes(1);
    expect(scenario.compositeNow).toHaveBeenCalledTimes(2);
  });

  it('keeps prerender paused and closes an open visual only when deferred layout finishes', () => {
    const scenario = createScenario();
    scenario.runtime.begin('forward');

    const finish = scenario.runtime.deferForLayout('forward');
    expect(scenario.events).toEqual([]);
    expect(scenario.resumePrerender).not.toHaveBeenCalled();

    finish?.();

    expect(scenario.events).toEqual(['end:forward']);
    expect(scenario.resumePrerender).toHaveBeenCalledTimes(1);
    expect(scenario.compositeNow).toHaveBeenCalledTimes(1);
  });

  it('closes its visual state before invoking a throwing transitionEnd listener', () => {
    const scenario = createScenario();
    scenario.runtime.begin('forward');
    const dispose = scenario.emitter.on('transitionEnd', () => {
      throw new Error('end listener failed');
    });

    expect(() => {
      scenario.runtime.visualSettled('forward');
    }).toThrow('end listener failed');
    dispose();
    scenario.runtime.complete('forward');

    expect(scenario.events).toEqual(['end:forward']);
    expect(scenario.resumePrerender).toHaveBeenCalledTimes(1);
  });
});

function createScenario(): {
  readonly runtime: ProvisionalTransitionRuntime;
  readonly emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>;
  readonly events: string[];
  readonly compositeNow: ReturnType<typeof vi.fn>;
  readonly pausePrerender: ReturnType<typeof vi.fn>;
  readonly resumePrerender: ReturnType<typeof vi.fn>;
  readonly schedulePrerender: ReturnType<typeof vi.fn>;
} {
  const emitter = createEmitter<ReaderControllerEvents>();
  const events: string[] = [];
  emitter.on('transitionEnd', ({ direction }) => {
    events.push(`end:${direction}`);
  });
  const compositeNow = vi.fn();
  const frameDriver = {
    compositeNow,
    scheduleComposite: vi.fn(),
  };
  const pausePrerender = vi.fn();
  const resumePrerender = vi.fn();
  const schedulePrerender = vi.fn();
  const prerenderScheduler: PrerenderScheduler = {
    schedule: schedulePrerender,
    pause: pausePrerender,
    resume: resumePrerender,
    dispose: vi.fn(),
  };
  const runtime = createProvisionalTransitionRuntime(
    { currentSpread: 3 } as Internals,
    emitter,
    frameDriver as unknown as FrameDriver,
    {} as Reader,
    {} as PageBufferPool,
    vi.fn(() => true) as ContentRenderer,
    prerenderScheduler,
    () => false,
  );
  return {
    runtime,
    emitter,
    events,
    compositeNow,
    pausePrerender,
    resumePrerender,
    schedulePrerender,
  };
}
