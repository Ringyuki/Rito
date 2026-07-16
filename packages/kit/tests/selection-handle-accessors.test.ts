import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildSelectionAccessors } from '../src/controller/facade/selection-accessors';
import { SELECTION_EDGE_DWELL_MS } from '../src/controller/facade/selection-edge-navigation';
import type { Internals } from '../src/controller/facade/types';
import { registerSelectionInteractionOwner } from '../src/interaction/selection/selection-interaction-owner';

afterEach(() => {
  vi.useRealTimers();
});

describe('selection handle controller facade', () => {
  it('keeps the initial grab offset while converting client input to spread content', () => {
    const nativeDrag = { update: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    const cssToSpreadContent = vi.fn((x: number, y: number) => ({ x: x / 2, y: y / 2 }));
    const beginHandleDrag = vi.fn(() => nativeDrag);
    const selection = registerStaticSelectionOwner({
      getHandleCarets: () => ({
        start: { x: 10, y: 20, width: 0, height: 10 },
        end: { x: 30, y: 20, width: 0, height: 10 },
        focusEdge: 'end' as const,
      }),
      beginHandleDrag,
    });
    const internals = {
      renderScale: 2,
      engines: { selection },
      coordState: {
        mapper: {
          spreadContentRectToViewport: (rect: { x: number; y: number }) => ({
            ...rect,
            x: rect.x + 40,
            y: rect.y + 40,
          }),
          cssToSpreadContent,
        },
      },
    } as unknown as Internals;
    const canvas = {
      getBoundingClientRect: () => ({ left: 100, top: 50 }),
    } as unknown as HTMLCanvasElement;
    const accessors = buildSelectionAccessors(internals, canvas, navStub());

    // End caret center is (240, 180) in client space; grab it 10px right / 15px below.
    const drag = accessors.beginSelectionHandleDrag('end', { clientX: 250, clientY: 195 });
    expect(drag).not.toBeNull();
    drag?.update({ clientX: 270, clientY: 215 });
    drag?.finish({ clientX: 290, clientY: 235 });

    expect(beginHandleDrag).toHaveBeenCalledWith('end');
    expect(cssToSpreadContent).toHaveBeenNthCalledWith(1, 160, 150);
    expect(cssToSpreadContent).toHaveBeenNthCalledWith(2, 180, 170);
    expect(nativeDrag.update).toHaveBeenCalledWith({ x: 80, y: 75 });
    expect(nativeDrag.finish).toHaveBeenCalledWith({ x: 90, y: 85 });
    drag?.cancel();
    expect(nativeDrag.cancel).not.toHaveBeenCalled();
  });

  it('rejects unavailable or non-finite drag origins', () => {
    const beginHandleDrag = vi.fn();
    const internals = {
      engines: {
        selection: {
          getHandleCarets: () => null,
          beginHandleDrag,
        },
      },
      coordState: { mapper: null },
    } as unknown as Internals;
    const accessors = buildSelectionAccessors(internals, {} as HTMLCanvasElement, navStub());

    expect(
      accessors.beginSelectionHandleDrag('start', { clientX: Number.NaN, clientY: 0 }),
    ).toBeNull();
    expect(accessors.beginSelectionHandleDrag('start', { clientX: 0, clientY: 0 })).toBeNull();
    expect(beginHandleDrag).not.toHaveBeenCalled();
  });

  it('fails an unregistered handle engine closed before starting its session', () => {
    const beginHandleDrag = vi.fn();
    const internals = {
      renderScale: 1,
      reader: { totalSpreads: 1 },
      engines: {
        selection: {
          getHandleCarets: () => ({
            start: { x: 10, y: 20, width: 0, height: 10 },
            end: { x: 30, y: 20, width: 0, height: 10 },
            focusEdge: 'end',
          }),
          beginHandleDrag,
        },
      },
      coordState: { mapper: mapperWithWidth(300), contentInteractionGeneration: 0 },
    } as unknown as Internals;
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 200 }),
    } as unknown as HTMLCanvasElement;
    const accessors = buildSelectionAccessors(internals, canvas, navStub());

    expect(accessors.beginSelectionHandleDrag('end', { clientX: 30, clientY: 25 })).toBeNull();
    expect(beginHandleDrag).not.toHaveBeenCalled();
  });

  it('cancels a handle press released at its origin without resolving another caret', () => {
    const fixture = handleAccessorsFixture();
    const drag = fixture.accessors.beginSelectionHandleDrag('start', fixture.origin);

    drag?.update(fixture.origin);
    drag?.finish(fixture.origin);

    expect(fixture.nativeDrag.update).not.toHaveBeenCalled();
    expect(fixture.nativeDrag.finish).not.toHaveBeenCalled();
    expect(fixture.nativeDrag.cancel).toHaveBeenCalledOnce();
    expect(fixture.cssToSpreadContent).not.toHaveBeenCalled();
  });

  it('uses a changed release coordinate even when no pointermove was delivered', () => {
    const fixture = handleAccessorsFixture();
    const drag = fixture.accessors.beginSelectionHandleDrag('start', fixture.origin);

    drag?.finish({ clientX: fixture.origin.clientX + 20, clientY: fixture.origin.clientY });

    expect(fixture.nativeDrag.finish).toHaveBeenCalledOnce();
    expect(fixture.nativeDrag.cancel).not.toHaveBeenCalled();
  });

  it('snaps to a known adjacent spread and replays against its clamped content edge', () => {
    vi.useFakeTimers();
    const nativeDrag = { update: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    const coordState = {
      mapper: mapperWithWidth(300),
      contentInteractionGeneration: 0,
      selectionProjectionTransfer: null as { readonly targetSpreadIndex: number } | null,
    };
    const selection = registerStaticSelectionOwner({
      getHandleCarets: () => ({
        start: { x: 10, y: 20, width: 0, height: 10 },
        end: { x: 30, y: 20, width: 0, height: 10 },
        focusEdge: 'end' as const,
      }),
      beginHandleDrag: () => nativeDrag,
    });
    const internals = {
      currentSpread: 0,
      renderScale: 1,
      reader: { totalSpreads: 2 },
      engines: { selection },
      coordState,
    } as unknown as Internals;
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 200 }),
    } as unknown as HTMLCanvasElement;
    const jumpToSpreadIfReady = vi.fn((target: number) => {
      internals.currentSpread = target;
      coordState.mapper = mapperWithWidth(100);
      return 'committed' as const;
    });
    const accessors = buildSelectionAccessors(internals, canvas, {
      jumpToSpreadIfReady,
      prepareSpreadForJump: vi.fn(() => 'ready'),
    } as never);
    const drag = accessors.beginSelectionHandleDrag('end', { clientX: 30, clientY: 25 });

    drag?.update({ clientX: 298, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(jumpToSpreadIfReady).toHaveBeenCalledWith(1, true);
    expect(nativeDrag.update).toHaveBeenNthCalledWith(1, { x: 298, y: 25 });
    expect(nativeDrag.update).toHaveBeenNthCalledWith(2, { x: 100, y: 25 });
  });

  it('does not replay a stale handle after ready-jump selection reentrancy', () => {
    vi.useFakeTimers();
    const nativeDrag = { update: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
    let selectionGeneration = 0;
    const selection = registerSelectionInteractionOwner(
      {
        getHandleCarets: () => ({
          start: { x: 10, y: 20, width: 0, height: 10 },
          end: { x: 30, y: 20, width: 0, height: 10 },
          focusEdge: 'end' as const,
        }),
        beginHandleDrag: () => {
          selectionGeneration += 1;
          return nativeDrag;
        },
        clear: () => {
          selectionGeneration += 1;
        },
      },
      () => selectionGeneration,
    );
    const coordState = {
      mapper: mapperWithWidth(300),
      contentInteractionGeneration: 0,
    };
    const internals = {
      currentSpread: 0,
      renderScale: 1,
      reader: { totalSpreads: 2 },
      engines: { selection },
      coordState,
    } as unknown as Internals;
    const canvas = {
      getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 200 }),
    } as unknown as HTMLCanvasElement;
    const jumpToSpreadIfReady = vi.fn(() => {
      coordState.contentInteractionGeneration += 1;
      selection.clear();
      return 'committed' as const;
    });
    const accessors = buildSelectionAccessors(internals, canvas, {
      jumpToSpreadIfReady,
      prepareSpreadForJump: vi.fn(() => 'ready'),
    } as never);
    const drag = accessors.beginSelectionHandleDrag('end', { clientX: 30, clientY: 25 });

    drag?.update({ clientX: 298, clientY: 25 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);

    expect(jumpToSpreadIfReady).toHaveBeenCalledOnce();
    expect(nativeDrag.update).toHaveBeenCalledOnce();
  });

  it('publishes a completed extent but does not revive growth across a newer navigation intent', async () => {
    vi.useFakeTimers();
    const fixture = partialExtentHandleFixture();
    const drag = fixture.accessors.beginSelectionHandleDrag('end', fixture.origin);

    drag?.update(fixture.edgePoint);
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    expect(fixture.ensureSelectionSpread).toHaveBeenCalledOnce();

    fixture.internals.coordState.contentInteractionGeneration += 1;
    fixture.growth.resolve(true);
    await settleTasks();

    expect(fixture.publishExtent).toHaveBeenCalledOnce();
    expect(fixture.reader.totalSpreads).toBe(2);
    expect(fixture.prepareSpreadForJump).not.toHaveBeenCalled();
    expect(fixture.jumpToSpreadIfReady).not.toHaveBeenCalled();

    drag?.update({ ...fixture.edgePoint, clientX: fixture.edgePoint.clientX - 1 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    expect(fixture.prepareSpreadForJump).not.toHaveBeenCalled();
    expect(fixture.jumpToSpreadIfReady).not.toHaveBeenCalled();
  });

  it('fails a pending growth closed when a full layout invalidates its handle session', async () => {
    vi.useFakeTimers();
    const fixture = partialExtentHandleFixture();
    const drag = fixture.accessors.beginSelectionHandleDrag('end', fixture.origin);

    drag?.update(fixture.edgePoint);
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    fixture.invalidateFullLayout();
    fixture.growth.resolve(true);
    await settleTasks();

    expect(fixture.invalidateSelection).toHaveBeenCalledOnce();
    expect(fixture.publishExtent).toHaveBeenCalledOnce();
    expect(fixture.jumpToSpreadIfReady).not.toHaveBeenCalled();
  });

  it('does not revive pending growth after the selection is cleared', async () => {
    vi.useFakeTimers();
    const fixture = partialExtentHandleFixture();
    const drag = fixture.accessors.beginSelectionHandleDrag('end', fixture.origin);

    drag?.update(fixture.edgePoint);
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    fixture.accessors.clearSelection();
    fixture.growth.resolve(true);
    await settleTasks();

    expect(fixture.clearSelection).toHaveBeenCalledOnce();
    expect(fixture.publishExtent).toHaveBeenCalledOnce();
    expect(fixture.jumpToSpreadIfReady).not.toHaveBeenCalled();
  });

  it('does not revive pending growth after a replacement selection starts', async () => {
    vi.useFakeTimers();
    const fixture = partialExtentHandleFixture();
    const drag = fixture.accessors.beginSelectionHandleDrag('end', fixture.origin);

    drag?.update(fixture.edgePoint);
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    fixture.startSelection();
    fixture.growth.resolve(true);
    await settleTasks();

    expect(fixture.publishExtent).toHaveBeenCalledOnce();
    expect(fixture.jumpToSpreadIfReady).not.toHaveBeenCalled();
  });

  it('keeps an aborted growth publication without retrying its cancelled handle', async () => {
    vi.useFakeTimers();
    const fixture = partialExtentHandleFixture();
    const drag = fixture.accessors.beginSelectionHandleDrag('end', fixture.origin);

    drag?.update(fixture.edgePoint);
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    const signal = fixture.ensureSelectionSpread.mock.calls[0]?.[1];
    drag?.cancel();
    fixture.growth.resolve(true);
    await settleTasks();

    expect(signal?.aborted).toBe(true);
    expect(fixture.publishExtent).toHaveBeenCalledOnce();
    expect(fixture.reader.totalSpreads).toBe(2);
    expect(fixture.jumpToSpreadIfReady).not.toHaveBeenCalled();
  });
});

function handleAccessorsFixture() {
  const nativeDrag = { update: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
  const cssToSpreadContent = vi.fn((x: number, y: number) => ({ x, y }));
  const selection = registerStaticSelectionOwner({
    getHandleCarets: () => ({
      start: { x: 10, y: 20, width: 0, height: 10 },
      end: { x: 30, y: 20, width: 0, height: 10 },
      focusEdge: 'end' as const,
    }),
    beginHandleDrag: () => nativeDrag,
  });
  const internals = {
    renderScale: 1,
    engines: { selection },
    coordState: {
      mapper: {
        spreadContentRectToViewport: (rect: { x: number; y: number }) => rect,
        cssToSpreadContent,
      },
    },
  } as unknown as Internals;
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, top: 0 }),
  } as unknown as HTMLCanvasElement;
  return {
    accessors: buildSelectionAccessors(internals, canvas, navStub()),
    cssToSpreadContent,
    nativeDrag,
    origin: { clientX: 10, clientY: 25 },
  };
}

function navStub() {
  return {
    jumpToSpreadIfReady: vi.fn(() => 'not-ready'),
    prepareSpreadForJump: vi.fn(() => 'not-ready'),
  } as never;
}

function partialExtentHandleFixture() {
  const growth = deferred<boolean>();
  const nativeDrag = { update: vi.fn(), finish: vi.fn(), cancel: vi.fn() };
  const invalidateSelection = vi.fn();
  const clearSelection = vi.fn();
  const publishExtent = vi.fn();
  const reader = {
    totalSpreads: 1,
    pagination: { complete: false },
  };
  const coordState = {
    mapper: mapperWithWidth(300),
    contentInteractionGeneration: 0,
  };
  let selectionGeneration = 0;
  const selection = registerSelectionInteractionOwner(
    {
      getHandleCarets: () => ({
        start: { x: 10, y: 20, width: 0, height: 10 },
        end: { x: 30, y: 20, width: 0, height: 10 },
        focusEdge: 'end' as const,
      }),
      beginHandleDrag: () => {
        selectionGeneration += 1;
        return nativeDrag;
      },
      handlePointerDown: () => {
        selectionGeneration += 1;
      },
      clear: () => {
        selectionGeneration += 1;
        clearSelection();
      },
      invalidate: () => {
        selectionGeneration += 1;
        invalidateSelection();
      },
    },
    () => selectionGeneration,
  );
  const internals = {
    currentSpread: 0,
    renderScale: 1,
    reader,
    engines: { selection },
    coordState,
  } as unknown as Internals;
  const ensureSelectionSpread = vi.fn(async (_target: number, signal: AbortSignal) => {
    const available = await growth.promise;
    reader.totalSpreads = 2;
    reader.pagination.complete = true;
    publishExtent();
    return signal.aborted ? undefined : available;
  });
  const prepareSpreadForJump = vi.fn(() => 'ready' as const);
  const jumpToSpreadIfReady = vi.fn(() => 'committed' as const);
  const canvas = {
    getBoundingClientRect: () => ({ left: 0, right: 300, top: 0, bottom: 200 }),
  } as unknown as HTMLCanvasElement;
  return {
    accessors: buildSelectionAccessors(internals, canvas, {
      ensureSelectionSpread,
      prepareSpreadForJump,
      jumpToSpreadIfReady,
    } as never),
    edgePoint: { clientX: 298, clientY: 25 },
    clearSelection,
    ensureSelectionSpread,
    growth,
    internals,
    invalidateFullLayout() {
      coordState.contentInteractionGeneration += 1;
      invalidateSelection();
    },
    invalidateSelection,
    jumpToSpreadIfReady,
    nativeDrag,
    origin: { clientX: 30, clientY: 25 },
    prepareSpreadForJump,
    publishExtent,
    reader,
    startSelection() {
      selection.handlePointerDown();
    },
  };
}

function registerStaticSelectionOwner<T extends object>(selection: T): T {
  return registerSelectionInteractionOwner(selection, () => 0);
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
}

function mapperWithWidth(contentWidth: number) {
  return {
    spreadContentRectToViewport: (rect: { readonly x: number; readonly y: number }) => rect,
    cssToSpreadContent: (x: number, y: number) => ({ x, y }),
    getPages: () => [
      {
        pageIndex: 0,
        side: 'single' as const,
        contentOriginX: 0,
        contentOriginY: 0,
        spreadContentOriginX: 0,
        contentWidth,
        contentHeight: 100,
      },
    ],
  };
}
