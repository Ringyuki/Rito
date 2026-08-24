import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPrimarySelectionDragNavigation } from '../src/controller/facade/selection-primary-drag';
import { SELECTION_EDGE_DWELL_MS } from '../src/controller/facade/selection-edge-navigation';
import type { Internals } from '../src/controller/facade/types';
import type { NavigationJumpOutcome } from '../src/controller/navigation/jump';
import { bindPointerEvents } from '../src/controller/wiring/pointer';
import type { SelectionGestureLease } from '../src/interaction/selection/selection-interaction-owner';
import { registerSelectionInteractionOwner } from '../src/interaction/selection/selection-interaction-owner';
import { createDomTarget, pointer, pointerPosition } from './helpers/dom-input';

afterEach(() => {
  vi.useRealTimers();
});

describe('primary selection edge navigation', () => {
  it('snaps forward and replays the stationary pointer through the new mapper', () => {
    vi.useFakeTimers();
    const fixture = primaryDragFixture();
    const session = fixture.begin();

    session?.update({ clientX: 298, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(fixture.prepareSpreadForJump).toHaveBeenCalledWith(1);
    expect(fixture.jumpToSpreadIfReady).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ generation: 1 }),
    );
    expect(fixture.supersedeForSelectionIntent).toHaveBeenCalledOnce();
    expect(fixture.selectionMove).toHaveBeenCalledWith({ x: 100, y: 25 });
    expect(session?.didNavigate()).toBe(true);
  });

  it('snaps backward and clamps replay to the leading visible page edge', () => {
    vi.useFakeTimers();
    const fixture = primaryDragFixture({ currentSpread: 1 });
    fixture.jumpToSpreadIfReady.mockImplementation((target: number) => {
      fixture.internals.coordState.contentInteractionGeneration += 1;
      fixture.internals.currentSpread = target;
      fixture.internals.coordState.mapper = mapperWithWidth(120, 20);
      return 'committed';
    });
    const session = fixture.begin();

    session?.update({ clientX: 2, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(fixture.prepareSpreadForJump).toHaveBeenCalledWith(0);
    expect(fixture.selectionMove).toHaveBeenCalledWith({ x: 20, y: 25 });
    expect(session?.didNavigate()).toBe(true);
  });

  it('grows a lazy tail, keeps the latest client sample, then snaps without another move', async () => {
    vi.useFakeTimers();
    const growth = deferred<boolean>();
    const fixture = primaryDragFixture({ totalSpreads: 1, paginationComplete: false });
    fixture.ensureSelectionSpread.mockImplementation(async (_target, signal) => {
      const available = await growth.promise;
      fixture.reader.totalSpreads = 2;
      fixture.reader.pagination.complete = true;
      return signal.aborted ? undefined : available;
    });
    const session = fixture.begin();

    session?.update({ clientX: 298, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    expect(fixture.ensureSelectionSpread).toHaveBeenCalledOnce();
    session?.update({ clientX: 299, clientY: 60 });
    growth.resolve(true);
    await settleTasks();

    expect(fixture.jumpToSpreadIfReady).toHaveBeenCalledOnce();
    expect(fixture.selectionMove).toHaveBeenCalledWith({ x: 100, y: 60 });
    expect(session?.didNavigate()).toBe(true);
  });

  it('aborts pending growth on finish and never revives the released gesture', async () => {
    vi.useFakeTimers();
    const growth = deferred<boolean>();
    const fixture = primaryDragFixture({ totalSpreads: 1, paginationComplete: false });
    fixture.ensureSelectionSpread.mockImplementation(async (_target, signal) => {
      const available = await growth.promise;
      fixture.reader.totalSpreads = 2;
      return signal.aborted ? undefined : available;
    });
    const session = fixture.begin();

    session?.update({ clientX: 298, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    const signal = fixture.ensureSelectionSpread.mock.calls[0]?.[1];
    session?.finish();
    fixture.endSelection();
    growth.resolve(true);
    await settleTasks();

    expect(signal?.aborted).toBe(true);
    expect(fixture.jumpToSpreadIfReady).not.toHaveBeenCalled();
    expect(fixture.selectionMove).not.toHaveBeenCalled();
  });

  it('fails closed when synchronous start listeners replace the new gesture', () => {
    const fixture = primaryDragFixture();
    const input = fixture.navigation.claim();
    if (!input) throw new Error('missing selection input claim');

    const session = fixture.navigation.begin(input, () => {
      fixture.startSelection();
      fixture.startSelection();
    });

    expect(session).not.toBeNull();
    expect(session?.owns()).toBe(false);
    expect(session?.wasSuperseded()).toBe(true);
  });

  it('does not start selection when claiming it synchronously accepts newer content work', () => {
    const fixture = primaryDragFixture();
    fixture.supersedeForSelectionIntent.mockImplementation(() => {
      fixture.internals.coordState.contentInteractionGeneration += 2;
      return { owns: () => false };
    });
    const start = vi.fn(fixture.startSelection);

    const input = fixture.navigation.claim();

    expect(start).not.toHaveBeenCalled();
    expect(input).toBeNull();
  });

  it('distinguishes a naturally settled empty gesture from replacement', () => {
    const fixture = primaryDragFixture();
    const session = fixture.begin();

    fixture.settleSelection();

    expect(session?.owns()).toBe(false);
    expect(session?.wasSuperseded()).toBe(false);
  });

  it('retains exact cancellation ownership after an external content intent', () => {
    const fixture = primaryDragFixture();
    const session = fixture.begin();

    fixture.internals.coordState.contentInteractionGeneration += 1;

    expect(session?.owns()).toBe(false);
    expect(session?.wasSuperseded()).toBe(true);
    expect(session?.cancel()).toBe(true);
  });

  it('retains exact cancellation ownership when start is rejected by content reentrancy', () => {
    const fixture = primaryDragFixture();
    const input = fixture.navigation.claim();
    if (!input) throw new Error('missing selection input claim');

    const session = fixture.navigation.begin(input, () => {
      fixture.startSelection();
      fixture.internals.coordState.contentInteractionGeneration += 1;
    });

    expect(session?.owns()).toBe(false);
    expect(session?.cancel()).toBe(true);
  });

  it('retains exact ownership during the jump-owned projection generation', () => {
    vi.useFakeTimers();
    const fixture = primaryDragFixture();
    const session = fixture.begin();
    let ownsDuringProjection = false;
    let supersededDuringProjection = true;
    fixture.jumpToSpreadIfReady.mockImplementation((target, gesture) => {
      fixture.internals.coordState.contentInteractionGeneration += 1;
      fixture.internals.coordState.selectionProjectionTransfer = {
        targetSpreadIndex: target,
        gesture,
      };
      ownsDuringProjection = session?.owns() === true;
      supersededDuringProjection = session?.wasSuperseded() === true;
      fixture.internals.currentSpread = target;
      fixture.internals.coordState.mapper = mapperWithWidth(100);
      fixture.internals.coordState.selectionProjectionTransfer = null;
      return 'committed';
    });

    session?.update({ clientX: 298, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(ownsDuringProjection).toBe(true);
    expect(supersededDuringProjection).toBe(false);
    expect(session?.didNavigate()).toBe(true);
  });

  it('finalizes pointerup reentered synchronously from the projection commit', () => {
    vi.useFakeTimers();
    const dom = createDomTarget();
    const canvas = dom.target as HTMLCanvasElement;
    canvas.getBoundingClientRect = () => ({ left: 0, right: 300, top: 0, bottom: 200 }) as DOMRect;
    let selectionGeneration = 0;
    let activeGesture: object | null = null;
    let state: 'idle' | 'selecting' | 'selected' = 'idle';
    const selectionUp = vi.fn(() => {
      activeGesture = null;
      state = 'selected';
    });
    const click = vi.fn();
    const selection = registerSelectionInteractionOwner(
      {
        handlePointerDown: () => {
          selectionGeneration += 1;
          activeGesture = {};
          state = 'selecting';
        },
        handlePointerMove: vi.fn(),
        handlePointerUp: selectionUp,
        getState: () => state,
      },
      () => selectionGeneration,
      {
        capture: () => activeGesture,
        owns: (candidate) => candidate === activeGesture && state === 'selecting',
        supportsProjectionTransfer: true,
      },
    );
    const internals = {
      currentSpread: 0,
      reader: { totalSpreads: 2, pagination: { complete: true } },
      engines: { selection },
      coordState: {
        mapper: mapperWithWidth(300),
        contentInteractionGeneration: 0,
        selectionProjectionTransfer: null,
      },
    } as unknown as Internals;
    const navigation = createPrimarySelectionDragNavigation(internals, canvas, {
      ensureSelectionSpread: vi.fn(),
      prepareSpreadForJump: vi.fn(() => 'ready'),
      supersedeForSelectionIntent: () => {
        internals.coordState.contentInteractionGeneration += 1;
        return { owns: () => true };
      },
      jumpToSpreadIfReady: (target: number, gesture: SelectionGestureLease) => {
        internals.coordState.contentInteractionGeneration += 1;
        internals.coordState.selectionProjectionTransfer = { targetSpreadIndex: target, gesture };
        internals.currentSpread = target;
        internals.coordState.mapper = mapperWithWidth(100);
        dom.emit('pointerup', pointer(1, 299, 25));
        internals.coordState.selectionProjectionTransfer = null;
        return 'committed';
      },
    } as never);
    const dispose = bindPointerEvents(
      canvas,
      selection as never,
      pointerPosition,
      click,
      navigation,
    );

    dom.emit('pointerdown', pointer(1, 299, 25));
    dom.emit('pointermove', pointer(1, 299, 25));
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(selectionUp).toHaveBeenCalledWith({ x: 100, y: 25 });
    expect(state).toBe('selected');
    expect(click).not.toHaveBeenCalled();
    dispose();
  });

  it('keeps an inside-left-page release exact after a forward spread turn', () => {
    vi.useFakeTimers();
    const fixture = primaryDragFixture();
    fixture.jumpToSpreadIfReady.mockImplementation((target: number) => {
      fixture.internals.coordState.contentInteractionGeneration += 1;
      fixture.internals.currentSpread = target;
      fixture.internals.coordState.mapper = twoPageMapper();
      return 'committed';
    });
    const session = fixture.begin();

    session?.update({ clientX: 298, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(session?.resolveFinalInput?.({ clientX: 60, clientY: 25 })).toEqual({ x: 60, y: 25 });
    session?.cancel();
  });

  it('uses the final left edge after turning forward twice and backward once', () => {
    vi.useFakeTimers();
    const fixture = primaryDragFixture({ currentSpread: 5, totalSpreads: 8 });
    fixture.jumpToSpreadIfReady.mockImplementation((target: number) => {
      fixture.internals.coordState.contentInteractionGeneration += 1;
      fixture.internals.currentSpread = target;
      fixture.internals.coordState.mapper = twoPageMapper();
      return 'committed';
    });
    const session = fixture.begin();

    session?.update({ clientX: 298, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    session?.update({ clientX: 2, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(fixture.internals.currentSpread).toBe(6);
    expect(session?.resolveFinalInput?.({ clientX: 2, clientY: 25 })).toEqual({ x: 20, y: 25 });
    session?.cancel();
  });

  it('marks a physical spread change even when ready-jump ownership is superseded', () => {
    vi.useFakeTimers();
    const fixture = primaryDragFixture();
    fixture.jumpToSpreadIfReady.mockImplementation((target: number) => {
      fixture.internals.currentSpread = target;
      return 'superseded';
    });
    const session = fixture.begin();

    session?.update({ clientX: 298, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(session?.didNavigate()).toBe(true);
    expect(fixture.selectionMove).not.toHaveBeenCalled();
  });
});

interface PrimaryDragFixtureOptions {
  readonly currentSpread?: number;
  readonly totalSpreads?: number;
  readonly paginationComplete?: boolean;
}

function primaryDragFixture(options: PrimaryDragFixtureOptions = {}) {
  let selectionGeneration = 0;
  let activeGesture: object | null = null;
  let state: 'idle' | 'selecting' = 'idle';
  const selectionMove = vi.fn();
  const selection = registerSelectionInteractionOwner(
    {
      handlePointerDown: () => {
        selectionGeneration += 1;
        activeGesture = {};
        state = 'selecting';
      },
      handlePointerMove: selectionMove,
      getState: () => state,
    },
    () => selectionGeneration,
    {
      capture: () => activeGesture,
      owns: (candidate) => candidate === activeGesture && state === 'selecting',
      supportsProjectionTransfer: true,
    },
  );
  const reader = {
    totalSpreads: options.totalSpreads ?? 2,
    pagination: { complete: options.paginationComplete ?? true },
  };
  const internals = {
    currentSpread: options.currentSpread ?? 0,
    reader,
    engines: { selection },
    coordState: {
      mapper: mapperWithWidth(300),
      contentInteractionGeneration: 0,
    },
  } as unknown as Internals;
  const ensureSelectionSpread = vi.fn<
    (target: number, signal: AbortSignal) => Promise<boolean | undefined>
  >(() => Promise.resolve(false));
  const prepareSpreadForJump = vi.fn(() => 'ready' as const);
  const supersedeForSelectionIntent = vi.fn<() => { readonly owns: () => boolean }>(() => {
    internals.coordState.contentInteractionGeneration += 1;
    return { owns: () => true };
  });
  const jumpToSpreadIfReady = vi.fn<
    (target: number, gesture: SelectionGestureLease) => NavigationJumpOutcome
  >((target) => {
    internals.coordState.contentInteractionGeneration += 1;
    internals.currentSpread = target;
    internals.coordState.mapper = mapperWithWidth(100);
    return 'committed';
  });
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 200 }),
  } as unknown as HTMLCanvasElement;
  const navigation = createPrimarySelectionDragNavigation(internals, canvas, {
    ensureSelectionSpread,
    prepareSpreadForJump,
    supersedeForSelectionIntent,
    jumpToSpreadIfReady,
  } as never);
  const startSelection = (): void => {
    selection.handlePointerDown();
  };
  return {
    begin: () => {
      const input = navigation.claim();
      return input ? navigation.begin(input, startSelection) : null;
    },
    endSelection(): void {
      activeGesture = null;
      state = 'idle';
    },
    settleSelection(): void {
      activeGesture = null;
      state = 'idle';
    },
    ensureSelectionSpread,
    internals,
    jumpToSpreadIfReady,
    navigation,
    prepareSpreadForJump,
    reader,
    selectionMove,
    startSelection,
    supersedeForSelectionIntent,
  };
}

function mapperWithWidth(
  contentWidth: number,
  spreadContentOriginX = 0,
): NonNullable<Internals['coordState']['mapper']> {
  return {
    cssToSpreadContent: (x: number, y: number) => ({ x, y }),
    getPages: () => [
      {
        pageIndex: 0,
        side: 'single' as const,
        contentOriginX: 0,
        contentOriginY: 0,
        spreadContentOriginX,
        contentWidth,
        contentHeight: 100,
      },
    ],
  } as unknown as NonNullable<Internals['coordState']['mapper']>;
}

function twoPageMapper(): NonNullable<Internals['coordState']['mapper']> {
  return {
    cssToSpreadContent: (x: number, y: number) => ({ x, y }),
    getPages: () => [
      {
        pageIndex: 0,
        side: 'left' as const,
        contentOriginX: 0,
        contentOriginY: 0,
        spreadContentOriginX: 20,
        contentWidth: 100,
        contentHeight: 100,
      },
      {
        pageIndex: 1,
        side: 'right' as const,
        contentOriginX: 0,
        contentOriginY: 0,
        spreadContentOriginX: 160,
        contentWidth: 100,
        contentHeight: 100,
      },
    ],
  } as unknown as NonNullable<Internals['coordState']['mapper']>;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

async function settleTasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}
