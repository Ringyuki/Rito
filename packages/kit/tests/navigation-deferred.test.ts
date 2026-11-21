import { describe, expect, it, vi } from 'vitest';
import type { Reader, TocEntry } from '@ritojs/core';
import type { Internals } from '../src/controller/facade';
import { createNavigation, type NavigationDeps } from '../src/controller/navigation';
import type { ReaderControllerEvents } from '../src/controller/types';
import { createEmitter } from '../src/utils/event-emitter';
import { fakeTurns } from './helpers/fake-turns';
import { createPoolHarness, createRealTurns } from './helpers/real-turns';

// Turns a page whose spread is not painted yet: the engine asks for the
// page and waits for it, and the kit tells it when it is painted. Whatever
// else the reader is asked meanwhile takes the place of the waiting turn.

interface Waiting {
  readonly nav: ReturnType<typeof createNavigation>;
  readonly internals: { currentSpread: number };
  readonly slots: ReturnType<typeof createPoolHarness>['slots'];
  readonly td: ReturnType<typeof createRealTurns>['td'];
  /** The page of `spread` is painted, and the reader is told. */
  readonly paint: (spread: number) => void;
  readonly events: string[];
  readonly notified: number[];
  readonly emitter: ReturnType<typeof createEmitter<ReaderControllerEvents>>;
  /** Called as the reader is told of each spread it is on. */
  onNotify: (spread: number) => void;
  readonly onNavigationIntent: ReturnType<typeof vi.fn>;
  readonly onContentInteractionIntent: ReturnType<typeof vi.fn>;
  readonly onNavigationCancelled: ReturnType<typeof vi.fn>;
  readonly dispose: () => void;
}

/** A reader of `total` spreads on spread 0, only spread 0 painted. */
function waiting(total = 4, extra: { readonly toc?: (entry: TocEntry) => number } = {}): Waiting {
  const painted = new Set([0]);
  const notified: number[] = [];
  const internals = { currentSpread: 0 };
  const reader = {
    totalSpreads: total,
    spreads: Array.from({ length: total }, (_, index) => ({ index })),
    notifyActiveSpread: (spread: number) => {
      notified.push(spread);
      state.onNotify(spread);
    },
    resolveTocEntry: (entry: TocEntry) => {
      const spreadIndex = extra.toc?.(entry);
      return spreadIndex === undefined ? undefined : { pageIndex: spreadIndex, spreadIndex };
    },
  } as unknown as Reader;
  const { pool, slots } = createPoolHarness((index) => index !== null && painted.has(index));
  const emitter = createEmitter<ReaderControllerEvents>();
  const events: string[] = [];
  emitter.on('transitionStart', ({ direction }) => events.push(`start:${direction}`));
  emitter.on('transitionEnd', ({ outcome }) => events.push(`end:${outcome}`));
  emitter.on('spreadChange', ({ spreadIndex }) => events.push(`spread:${String(spreadIndex)}`));
  const turns = createRealTurns({
    internals: internals as unknown as Internals,
    reader,
    pool,
    emitter,
  });
  const onNavigationIntent = vi.fn();
  const onContentInteractionIntent = vi.fn();
  const onNavigationCancelled = vi.fn();
  const nav = createNavigation({
    getReader: () => reader,
    getCurrentSpread: () => internals.currentSpread,
    setCurrentSpread: (index: number) => {
      internals.currentSpread = index;
    },
    getRenderScale: () => 1,
    emitter,
    td: turns.td,
    turnTargets: turns.turnTargets,
    frameDriver: turns.frameDriver,
    pool,
    contentRenderer: vi.fn(() => true),
    onNavigationIntent,
    onContentInteractionIntent,
    onNavigationCancelled,
  });
  const state: Waiting = {
    nav,
    internals,
    slots,
    td: turns.td,
    paint: (spread) => {
      painted.add(spread);
      nav.notifyContentReady(spread);
    },
    events,
    notified,
    emitter,
    onNotify: () => undefined,
    onNavigationIntent,
    onContentInteractionIntent,
    onNavigationCancelled,
    dispose: () => {
      nav.dispose();
      turns.dispose();
    },
  };
  return state;
}

function settle(td: Waiting['td']): void {
  for (let frame = 0; td.isAnimating && frame < 500; frame += 1) td.step(16);
}

describe('a turn waiting for its page', () => {
  it('claims the position intent, asks for its page and begins once it is painted', () => {
    const reader = waiting();

    reader.nav.goToSpread(1);

    expect(reader.onNavigationIntent).toHaveBeenCalledOnce();
    expect(reader.onContentInteractionIntent).toHaveBeenCalledOnce();
    expect(reader.internals.currentSpread).toBe(0);
    expect(reader.slots.next).toBe(1);
    expect(reader.td.turning).toBe(false);
    expect(reader.events).toEqual([]);

    reader.paint(1);

    // It begins and lands at once: the reader is on spread 1 before it moves.
    expect(reader.events).toEqual(['start:forward', 'spread:1']);
    expect(reader.internals.currentSpread).toBe(1);
    expect(reader.notified).toEqual([1]);
    settle(reader.td);
    expect(reader.events).toEqual(['start:forward', 'spread:1', 'end:committed']);
    expect(reader.slots.curr).toBe(1);
    reader.dispose();
  });

  it('brings a spread further off into its slot, and lands there', () => {
    const reader = waiting();

    reader.nav.goToSpread(3);
    expect(reader.slots.next).toBe(3);
    reader.paint(3);
    settle(reader.td);

    expect(reader.internals.currentSpread).toBe(3);
    expect(reader.slots.curr).toBe(3);
    // Turns from there go to its neighbours again.
    reader.paint(2);
    reader.nav.prevSpread();
    expect(reader.internals.currentSpread).toBe(2);
    reader.dispose();
  });

  it('gives way to a turn asked for after it', () => {
    const reader = waiting();

    reader.nav.goToSpread(3);
    reader.nav.nextSpread();
    reader.paint(3);
    expect(reader.td.turning).toBe(false);
    reader.paint(1);

    expect(reader.internals.currentSpread).toBe(1);
    expect(reader.events).toEqual(['start:forward', 'spread:1']);
    reader.dispose();
  });

  it('is withdrawn by a navigation to where the reader already is', () => {
    const reader = waiting(4, { toc: () => 0 });

    reader.nav.goToSpread(1);
    reader.nav.goToSpread(0);
    expect(reader.onNavigationCancelled).toHaveBeenCalledOnce();
    reader.paint(1);
    expect(reader.td.turning).toBe(false);

    reader.nav.goToSpread(2);
    reader.nav.navigateToTocEntry({ label: 'Here', href: 'here.xhtml', children: [] });
    expect(reader.onNavigationCancelled).toHaveBeenCalledTimes(2);
    reader.paint(2);

    expect(reader.internals.currentSpread).toBe(0);
    expect(reader.events).toEqual([]);
    reader.dispose();
  });

  it('is dropped silently by a selection or a position asked for meanwhile', () => {
    const reader = waiting();

    reader.nav.goToSpread(1);
    reader.nav.supersedeForSelectionIntent();
    reader.paint(1);
    reader.nav.goToSpread(3);
    reader.nav.supersedeForPositionIntent();
    reader.paint(3);

    expect(reader.internals.currentSpread).toBe(0);
    expect(reader.td.turning).toBe(false);
    expect(reader.events).toEqual([]);
    expect(reader.onNavigationCancelled).not.toHaveBeenCalled();
    expect(reader.onContentInteractionIntent).toHaveBeenCalledTimes(4);
    reader.dispose();
  });

  it('gives way to a TOC entry, and to a jump', () => {
    const reader = waiting(4, { toc: () => 2 });

    reader.nav.goToSpread(1);
    reader.nav.navigateToTocEntry({ label: 'Two', href: 'two.xhtml', children: [] });
    reader.paint(1);
    expect(reader.td.turning).toBe(false);
    reader.paint(2);
    settle(reader.td);
    expect(reader.internals.currentSpread).toBe(2);

    reader.nav.goToSpread(3);
    reader.nav.jumpToSpread(0);
    reader.paint(3);
    expect(reader.internals.currentSpread).toBe(0);
    expect(reader.slots.curr).toBe(0);
    expect(reader.td.turning).toBe(false);
    reader.dispose();
  });
});

describe('a listener that redirects', () => {
  it('as a turn lands: the turn it asks for follows from the spread just landed on', () => {
    const reader = waiting();
    reader.paint(1);
    reader.paint(2);
    // The reader is told of spread 1 first, and asks for 2 there and then.
    reader.onNotify = (spread) => {
      if (spread === 1) reader.nav.goToSpread(2);
    };

    reader.nav.goToSpread(1);
    settle(reader.td);

    expect(reader.internals.currentSpread).toBe(2);
    expect(reader.notified).toEqual([1, 2]);
    // Two turns, each landed and told: the second carries on from the first.
    expect(reader.events.filter((event) => event.startsWith('spread'))).toEqual([
      'spread:1',
      'spread:2',
    ]);
    expect(reader.events.filter((event) => event.startsWith('end'))).toEqual([
      'end:committed',
      'end:committed',
    ]);
    expect(reader.slots.curr).toBe(2);
    reader.dispose();
  });

  it('as the turn on screen settles for a selection: the selection loses the reader', () => {
    const reader = waiting();
    reader.paint(1);
    reader.paint(2);
    reader.nav.goToSpread(1);
    reader.td.step(16);
    const redirect = vi.fn(() => {
      reader.nav.goToSpread(2);
    });
    reader.emitter.on('transitionEnd', ({ outcome }) => {
      if (outcome === 'committed' && redirect.mock.calls.length === 0) redirect();
    });

    const barrier = reader.nav.supersedeForSelectionIntent();

    expect(barrier).toBeNull();
    expect(redirect).toHaveBeenCalledOnce();
    expect(reader.internals.currentSpread).toBe(2);
    reader.dispose();
  });

  it('as a jump cuts off the turn on screen: the stale jump never lands', () => {
    const reader = waiting();
    reader.paint(1);
    reader.paint(2);
    reader.nav.goToSpread(1);
    reader.td.step(16);
    let redirected = false;
    reader.emitter.on('transitionEnd', ({ outcome }) => {
      if (outcome !== 'interrupted' || redirected) return;
      redirected = true;
      reader.nav.goToSpread(2);
    });

    reader.nav.jumpToSpread(3, true);

    expect(reader.internals.currentSpread).toBe(2);
    expect(reader.notified).not.toContain(3);
    reader.dispose();
  });
});

describe('a jump whose listener redirects', () => {
  function jumpingReader() {
    let currentSpread = 0;
    const notified: number[] = [];
    const spreadEvents: number[] = [];
    const redirect: { current?: () => void } = {};
    const emitter = {
      emit: vi.fn((event: string, payload: { spreadIndex?: number }) => {
        if (event === 'spreadChange' && payload.spreadIndex !== undefined) {
          spreadEvents.push(payload.spreadIndex);
        }
      }),
    };
    const reader = {
      totalSpreads: 3,
      spreads: [{}, {}, {}],
      notifyActiveSpread: vi.fn((spreadIndex: number) => {
        notified.push(spreadIndex);
        if (spreadIndex === 1) redirect.current?.();
      }),
    } as unknown as Reader;
    // A turn lands the reader on its spread, as the kit's turns do.
    const turns = fakeTurns(
      () => currentSpread,
      (spread) => {
        currentSpread = spread;
        reader.notifyActiveSpread(spread);
        emitter.emit('spreadChange', { spreadIndex: spread });
      },
    );
    const scheduleComposite = vi.fn();
    const nav = createNavigation({
      getReader: () => reader,
      getCurrentSpread: () => currentSpread,
      setCurrentSpread: (index: number) => {
        currentSpread = index;
      },
      emitter,
      td: turns.td,
      turnTargets: turns.turnTargets,
      frameDriver: { scheduleComposite },
      pool: { jump: vi.fn(), ensureContent: vi.fn(() => true) },
      contentRenderer: vi.fn(),
      onNavigationIntent: vi.fn(),
    } as unknown as NavigationDeps);
    return {
      nav,
      redirect,
      notified,
      spreadEvents,
      commands: turns.commands,
      scheduleComposite,
      current: () => currentSpread,
    };
  }

  it('installs the jump before the listener can redirect, and tells only where it went', () => {
    const jumping = jumpingReader();
    jumping.redirect.current = () => {
      jumping.nav.goToSpread(2);
    };

    jumping.nav.jumpToSpread(1, true);

    expect(jumping.current()).toBe(2);
    expect(jumping.notified).toEqual([1, 2]);
    expect(jumping.spreadEvents).toEqual([2]);
    expect(jumping.commands).toEqual([['next', 1, 2]]);
    expect(jumping.scheduleComposite).toHaveBeenCalledOnce();
  });
});
