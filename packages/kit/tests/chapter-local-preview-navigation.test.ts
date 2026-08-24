import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { Reader, ReaderLocator, ReaderLocatorResolution, Spread } from '@ritojs/core';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';
import { createTransitionDriver } from '../src/driver/transition-driver';
import { createPageBufferPool } from '../src/painter/buffer-pool';
import { createEmitter } from '../src/utils/event-emitter';
import type { ReaderControllerEvents } from '../src/controller/types';

const PRESENTATION = Symbol.for('@ritojs/core/browser/chapter-local-preview-presentation');

beforeAll(() => {
  if (typeof globalThis.OffscreenCanvas !== 'undefined') return;
  Object.assign(globalThis, {
    OffscreenCanvas: class TestOffscreenCanvas {
      width: number;
      height: number;

      constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
      }

      getContext() {
        return {
          canvas: this,
          clearRect: vi.fn(),
          fillRect: vi.fn(),
          strokeRect: vi.fn(),
          save: vi.fn(),
          restore: vi.fn(),
          scale: vi.fn(),
        };
      }
    },
  });
});

describe('chapter-local preview navigation', () => {
  it('ends the visible transition while retaining the provisional frame until exact promotion', async () => {
    const scenario = createScenario();
    scenario.startPreview();

    scenario.td.forceSettle();
    expect(scenario.events).toEqual(['start:forward', 'end:forward']);
    expect(scenario.pool.resolveDrawSlot('curr').provisional).toBe(true);
    expect(scenario.runtime.visualSettled).toHaveBeenCalledTimes(1);
    expect(scenario.runtime.complete).not.toHaveBeenCalled();
    expect(scenario.lease.finish).not.toHaveBeenCalled();

    scenario.locator.resolve(resolved(scenario.targetLocator, 1));
    await flushPromises();

    expect(scenario.current()).toBe(1);
    expect(scenario.pool.curr.spreadIndex).toBe(1);
    expect(scenario.events).toEqual(['start:forward', 'end:forward', 'spread:1']);
    expect(scenario.goToTarget).toHaveBeenCalledTimes(1);
    expect(scenario.runtime.complete).toHaveBeenCalledTimes(1);
    expect(scenario.lease.finish).toHaveBeenCalledTimes(1);
    expect(scenario.terminalSnapshots).toEqual([{ current: 0, poolCurrent: 0, composited: true }]);
  });

  it('publishes same-index exact once without a second animation', async () => {
    const scenario = createScenario();
    scenario.startPreview();
    scenario.td.forceSettle();

    scenario.locator.resolve(resolved(scenario.targetLocator, 0));
    await flushPromises();

    expect(scenario.events).toEqual(['start:forward', 'end:forward', 'spread:0']);
    expect(scenario.goToTarget).toHaveBeenCalledTimes(1);
    expect(scenario.pool.resolveDrawSlot('curr').provisional).toBe(false);
  });

  it('ends the visible transition when an early exact frame is not paintable yet', async () => {
    const scenario = createScenario();
    scenario.startPreview();
    scenario.setContentReady(false);
    scenario.locator.resolve(resolved(scenario.targetLocator, 1));
    await flushPromises();

    scenario.td.forceSettle();
    expect(scenario.events).toEqual(['start:forward', 'end:forward']);
    expect(scenario.pool.resolveDrawSlot('curr').provisional).toBe(true);
    expect(scenario.runtime.complete).not.toHaveBeenCalled();

    scenario.setContentReady(true);
    scenario.nav.notifyContentReady(1);

    expect(scenario.current()).toBe(1);
    expect(scenario.events).toEqual(['start:forward', 'end:forward', 'spread:1']);
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
  });

  it('reopens a balanced rollback animation when the frozen direction is wrong', async () => {
    const scenario = createScenario({ currentSpread: 1, previewDirection: 'forward' });
    scenario.startPreview();
    scenario.td.forceSettle();

    scenario.locator.resolve(resolved(scenario.targetLocator, 0));
    await flushPromises();
    expect(scenario.goToTarget).toHaveBeenCalledTimes(2);

    scenario.td.forceSettle();
    expect(scenario.goToTarget).toHaveBeenCalledTimes(2);
    expect(scenario.current()).toBe(0);
    expect(scenario.events).toEqual([
      'start:forward',
      'end:forward',
      'start:backward',
      'spread:0',
      'end:backward',
      'error:reader link locator navigation',
    ]);
    expect(scenario.events.filter((event) => event.startsWith('start:'))).toHaveLength(2);
    expect(scenario.events.filter((event) => event.startsWith('end:'))).toHaveLength(2);
  });

  it('blocks a superseding turn until a theme-stale rollback exact frame is paintable', async () => {
    const scenario = createScenario({ currentSpread: 1 });
    scenario.startPreview();
    scenario.td.forceSettle();
    scenario.pool.invalidateAllContent();
    scenario.nav.refreshChapterLocalTheme();
    scenario.setContentReady(false);
    scenario.locator.reject(new Error('main locator failed'));
    await flushPromises();
    scenario.td.forceSettle();

    expect(scenario.events).toContain('end:forward');
    expect(scenario.events).toContain('start:backward');
    expect(scenario.events).not.toContain('end:backward');
    const callsBeforeSupersede = scenario.goToTarget.mock.calls.length;
    scenario.nav.goToSpread(2);
    expect(scenario.goToTarget).toHaveBeenCalledTimes(callsBeforeSupersede);

    scenario.setContentReady(true);
    expect(scenario.nav.presentChapterLocalInvalidation(1)).toBe(true);

    const oldEnd = scenario.events.indexOf('end:backward');
    const newStart = scenario.events.lastIndexOf('start:forward');
    expect(oldEnd).toBeGreaterThanOrEqual(0);
    expect(newStart).toBeGreaterThan(oldEnd);
    expect(scenario.goToTarget.mock.lastCall).toEqual(['forward', 1, 2, 0]);
  });

  it('repaints an invalidated mount while exact fallback is still unresolved', async () => {
    const scenario = createScenario();
    scenario.startPreview();
    scenario.td.forceSettle();
    vi.spyOn(scenario.pool, 'refreshProvisionalStage').mockReturnValueOnce(false);

    scenario.nav.refreshChapterLocalTheme();
    scenario.td.forceSettle();
    scenario.setContentReady(false);
    scenario.pool.invalidateContentForSpread(0);

    expect(scenario.nav.presentChapterLocalInvalidation(0)).toBe(true);
    expect(scenario.pool.curr.contentDirty).toBe(true);
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    expect(scenario.events).not.toContain('end:backward');

    scenario.setContentReady(true);
    scenario.nav.notifyContentReady(0);
    expect(scenario.pool.curr.contentDirty).toBe(false);
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    expect(scenario.events).not.toContain('end:backward');

    scenario.locator.resolve(resolved(scenario.targetLocator, 1));
    await flushPromises();
    expect(scenario.current()).toBe(1);
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    expect(scenario.events.filter((event) => event === 'end:backward')).toHaveLength(1);
  });

  it('waits after fatal reset when ordinary mount rendering defers', async () => {
    const scenario = createScenario();
    scenario.startPreview();
    scenario.td.forceSettle();
    scenario.pool.invalidateAllContent();
    scenario.nav.refreshChapterLocalTheme();
    scenario.setContentReady(false);
    vi.spyOn(scenario.pool, 'completeProvisionalRollback').mockReturnValueOnce(false);
    vi.spyOn(scenario.pool, 'containProvisionalFailure').mockImplementationOnce((_token, mount) => {
      scenario.pool.resetProvisionalState(mount);
      return false;
    });
    scenario.locator.reject(new Error('main locator failed'));
    await flushPromises();

    scenario.td.forceSettle();
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    expect(scenario.events).not.toContain('end:backward');
    expect(scenario.pool.curr.contentDirty).toBe(true);

    scenario.setContentReady(true);
    scenario.nav.presentChapterLocalInvalidation(0);
    expect(scenario.pool.curr.contentDirty).toBe(false);
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    expect(scenario.events.filter((event) => event === 'end:backward')).toHaveLength(1);
  });

  it('contains rollback claim failure once without restarting the rollback spring', async () => {
    const scenario = createScenario();
    scenario.startPreview();
    scenario.td.forceSettle();
    vi.spyOn(scenario.pool, 'beginProvisionalRollback').mockReturnValueOnce(false);

    scenario.locator.reject(new Error('main locator failed'));
    await flushPromises();

    expect(scenario.td.isAnimating).toBe(false);
    expect(scenario.goToTarget).toHaveBeenCalledTimes(1);
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    expect(scenario.events.filter((event) => event.startsWith('error:'))).toHaveLength(1);
    expect(scenario.pool.resolveDrawSlot('curr').provisional).toBe(false);
  });

  it('queues reentrant spread navigation until exact publication has finalized', async () => {
    const scenario = createScenario();
    const dispose = scenario.emitter.on('spreadChange', ({ spreadIndex }) => {
      if (spreadIndex === 1) scenario.nav.goToSpread(2);
    });
    scenario.startPreview();
    scenario.td.forceSettle();

    scenario.locator.resolve(resolved(scenario.targetLocator, 1));
    await flushPromises();

    expect(scenario.events).toEqual([
      'start:forward',
      'end:forward',
      'spread:1',
      'spread:2',
      'start:forward',
    ]);
    expect(scenario.goToTarget.mock.calls).toEqual([
      ['forward', 0, 0],
      ['forward', 1, 2, 0],
    ]);
    dispose();
  });

  it('balances a throwing transitionStart listener and leaves TD/pool reusable', () => {
    const scenario = createScenario();
    const dispose = scenario.emitter.on('transitionStart', () => {
      throw new Error('start listener failed');
    });

    scenario.nav.navigateToLocator(scenario.targetLocator);
    expect(scenario.nav.presentChapterLocalInvalidation(scenario.current())).toBe(false);

    expect(scenario.td.isAnimating).toBe(false);
    expect(scenario.events.filter((event) => event === 'start:forward')).toHaveLength(1);
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    expect(() => {
      scenario.pool.jump(0);
    }).not.toThrow();
    dispose();
    scenario.nav.goToSpread(1);
    expect(scenario.goToTarget.mock.lastCall).toEqual(['forward', 0, 1, 0]);
  });

  it('does not emit a second visual end when a transitionEnd listener throws', async () => {
    const scenario = createScenario();
    const dispose = scenario.emitter.on('transitionEnd', () => {
      throw new Error('end listener failed');
    });
    scenario.startPreview();

    expect(() => scenario.td.forceSettle()).not.toThrow();
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    dispose();

    scenario.locator.resolve(resolved(scenario.targetLocator, 1));
    await flushPromises();

    expect(scenario.current()).toBe(1);
    expect(scenario.runtime.complete).toHaveBeenCalledTimes(1);
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
  });

  it('releases an uninstalled stage when the initial lease render throws', () => {
    const scenario = createScenario({ renderThrows: true });
    scenario.nav.navigateToLocator(scenario.targetLocator);

    expect(scenario.nav.presentChapterLocalInvalidation(0)).toBe(false);
    expect(scenario.td.isAnimating).toBe(false);
    expect(() => {
      scenario.pool.jump(1);
    }).not.toThrow();
    expect(scenario.pool.resolveDrawSlot('curr').provisional).toBe(false);
  });

  it('contains lease settle throws without letting the event reach ordinary rotation', async () => {
    const scenario = createScenario({ transitionSettledThrows: true });
    scenario.startPreview();
    scenario.locator.resolve(resolved(scenario.targetLocator, 0));
    await flushPromises();

    expect(() => scenario.td.forceSettle()).not.toThrow();
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    expect(scenario.pool.curr.spreadIndex).toBe(0);
    expect(scenario.pool.resolveDrawSlot('curr').provisional).toBe(false);
  });

  it('resumes an ordinary spread queued by the layout completion callback', () => {
    const scenario = createScenario();
    scenario.startPreview();
    scenario.runtime.deferForLayout.mockReturnValueOnce(() => {
      scenario.nav.goToSpread(2);
    });

    const finish = scenario.nav.terminateChapterLocalForLayout();
    expect(finish).toBeTypeOf('function');
    expect(scenario.goToTarget).toHaveBeenCalledTimes(1);

    finish?.();

    expect(scenario.goToTarget.mock.lastCall).toEqual(['forward', 0, 2, 0]);
  });

  it('terminalizes a throwing ordinary exact renderer without retaining runtime ownership', async () => {
    const scenario = createScenario();
    scenario.startPreview();
    scenario.td.forceSettle();
    scenario.setContentRendererThrows(true);

    scenario.locator.resolve(resolved(scenario.targetLocator, 1));
    await flushPromises();

    expect(scenario.td.isAnimating).toBe(false);
    expect(scenario.events.filter((event) => event === 'end:forward')).toHaveLength(1);
    expect(scenario.pool.resolveDrawSlot('curr').provisional).toBe(false);
    expect(() => {
      scenario.pool.jump(2);
    }).not.toThrow();
  });

  it('falls back to main exact after a queued preview claim disappears', async () => {
    const scenario = createScenario();
    scenario.nav.navigateToLocator(scenario.targetLocator);
    scenario.td.goToTarget('forward', 0, 1);
    expect(scenario.nav.presentChapterLocalInvalidation(0)).toBe(true);
    expect(scenario.pool.curr.contentDirty).toBe(true);
    scenario.setPresentationClaimable(false);
    scenario.td.forceSettle();
    await flushPromises();

    expect(scenario.pool.ensureContent('curr', () => true)).toBe(true);
    expect(scenario.pool.curr.contentDirty).toBe(false);

    scenario.locator.resolve(resolved(scenario.targetLocator, 1));
    await flushPromises();

    expect(scenario.goToTarget.mock.lastCall).toEqual(['forward', 0, 1, 0]);
  });

  it('keeps the exact mount dirty when a queued preview is superseded', () => {
    const scenario = createScenario();
    scenario.nav.navigateToLocator(scenario.targetLocator);
    scenario.td.goToTarget('forward', 0, 1);

    expect(scenario.nav.presentChapterLocalInvalidation(0)).toBe(true);
    expect(scenario.pool.curr.contentDirty).toBe(true);

    scenario.nav.goToSpread(2);

    expect(scenario.pool.ensureContent('curr', () => true)).toBe(true);
    expect(scenario.pool.curr.contentDirty).toBe(false);
  });
});

interface ScenarioOptions {
  readonly currentSpread?: number;
  readonly previewDirection?: 'forward' | 'backward';
  readonly transitionSettledThrows?: boolean;
  readonly renderThrows?: boolean;
}

function createScenario(options: ScenarioOptions = {}) {
  let currentSpread = options.currentSpread ?? 0;
  let contentReady = true;
  let presentationClaimable = true;
  let contentRendererThrows = false;
  let runtimeActive = false;
  let runtimeOwnerDirection: 'forward' | 'backward' | undefined;
  let runtimeOpenVisualDirection: 'forward' | 'backward' | undefined;
  let composited = false;
  const targetLocator: ReaderLocator = { href: 'late.xhtml', anchorId: 'target' };
  const locator = deferred<ReaderLocatorResolution | undefined>();
  const spreads = [spread(0), spread(1), spread(2)];
  const emitter = createEmitter<ReaderControllerEvents>();
  const events: string[] = [];
  const terminalSnapshots: Array<{
    current: number;
    poolCurrent: number | null;
    composited: boolean;
  }> = [];
  const pool = createPageBufferPool();
  pool.resize(300, 400, 1);
  pool.assignSlot('curr', currentSpread);
  pool.ensureContent('curr', () => true);
  const td = createTransitionDriver();
  td.viewportWidth = 300;
  const goToTarget = vi.spyOn(td, 'goToTarget');
  const frameDriver = {
    scheduleComposite: vi.fn(),
    compositeNow: vi.fn(() => {
      composited = true;
    }),
  };
  const lease = {
    direction: options.previewDirection ?? 'forward',
    render: vi.fn(() => {
      if (options.renderThrows) throw new Error('lease render failed');
      return true;
    }),
    composited: vi.fn(() => true),
    transitionSettled: vi.fn(() => {
      if (options.transitionSettledThrows) throw new Error('lease settle failed');
      return true;
    }),
    finish: vi.fn(() => true),
  };
  const reader = {
    totalSpreads: spreads.length,
    spreads,
    navigateToLocator: vi.fn(() => locator.promise),
    notifyActiveSpread: vi.fn(),
  } as unknown as Reader & { [PRESENTATION]: unknown };
  Object.defineProperty(reader, PRESENTATION, {
    value: {
      canClaim: () => presentationClaimable,
      claim: () => (presentationClaimable ? lease : undefined),
    },
  });
  emitter.on('transitionStart', ({ direction }) => events.push(`start:${direction}`));
  emitter.on('spreadChange', ({ spreadIndex }) => events.push(`spread:${String(spreadIndex)}`));
  emitter.on('error', ({ source }) => events.push(`error:${source}`));
  const runtime = {
    begin: vi.fn(() => {
      if (runtimeActive) throw new Error('runtime already active');
      runtimeActive = true;
      runtimeOwnerDirection = options.previewDirection ?? 'forward';
      runtimeOpenVisualDirection = options.previewDirection ?? 'forward';
    }),
    visualSettled: vi.fn((direction: 'forward' | 'backward') => {
      if (!runtimeActive || runtimeOpenVisualDirection !== direction) return;
      runtimeOpenVisualDirection = undefined;
      frameDriver.compositeNow();
      emitter.emit('transitionEnd', { direction });
    }),
    reopenVisual: vi.fn(
      (ownerDirection: 'forward' | 'backward', direction: 'forward' | 'backward') => {
        if (
          !runtimeActive ||
          runtimeOwnerDirection !== ownerDirection ||
          runtimeOpenVisualDirection !== undefined
        ) {
          return false;
        }
        runtimeOpenVisualDirection = direction;
        return true;
      },
    ),
    complete: vi.fn((direction: 'forward' | 'backward') => {
      if (!runtimeActive || runtimeOwnerDirection !== direction) return;
      const openVisualDirection = runtimeOpenVisualDirection;
      runtimeOwnerDirection = undefined;
      runtimeOpenVisualDirection = undefined;
      runtimeActive = false;
      frameDriver.compositeNow();
      if (openVisualDirection) emitter.emit('transitionEnd', { direction: openVisualDirection });
    }),
    cancel: vi.fn((direction: 'forward' | 'backward') => {
      if (!runtimeActive || runtimeOwnerDirection !== direction) return;
      runtimeActive = false;
      runtimeOwnerDirection = undefined;
      runtimeOpenVisualDirection = undefined;
    }),
    deferForLayout: vi.fn((): (() => void) | undefined => undefined),
  };
  const deps = {
    getReader: () => reader,
    getCurrentSpread: () => currentSpread,
    setCurrentSpread: (index: number) => {
      currentSpread = index;
    },
    getRenderScale: () => 1,
    emitter,
    td,
    frameDriver,
    pool,
    contentRenderer: vi.fn(() => {
      if (contentRendererThrows) throw new Error('exact renderer failed');
      return contentReady;
    }),
    provisionalRuntime: runtime,
  } as unknown as NavigationDeps;
  const nav = createNavigation(deps);
  td.onSettled((event) => {
    nav.handleTransitionSettled(event);
  });
  emitter.on('transitionEnd', ({ direction }) => {
    events.push(`end:${direction}`);
    terminalSnapshots.push({
      current: currentSpread,
      poolCurrent: pool.curr.spreadIndex,
      composited,
    });
  });

  return {
    nav,
    td,
    pool,
    emitter,
    events,
    terminalSnapshots,
    runtime,
    lease,
    goToTarget,
    targetLocator,
    locator,
    current: () => currentSpread,
    setContentReady(value: boolean) {
      contentReady = value;
    },
    setPresentationClaimable(value: boolean) {
      presentationClaimable = value;
    },
    setContentRendererThrows(value: boolean) {
      contentRendererThrows = value;
    },
    startPreview() {
      nav.navigateToLocator(targetLocator);
      expect(nav.presentChapterLocalInvalidation(currentSpread)).toBe(true);
    },
  };
}

function resolved(locator: ReaderLocator, spreadIndex: number): ReaderLocatorResolution {
  return {
    status: 'resolved',
    locator,
    spineIdref: `chapter-${String(spreadIndex)}`,
    pageIndex: spreadIndex,
    spreadIndex,
    matchedBy: 'anchor',
  };
}

function spread(index: number): Spread {
  return {
    index,
    left: {
      index,
      bounds: { x: 0, y: 0, width: 300, height: 400 },
      content: [],
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((accept, decline) => {
    resolve = accept;
    reject = decline;
  });
  return { promise, resolve, reject };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
