import { describe, expect, it, vi } from 'vitest';
import type { ReadingPosition } from '../src/interaction/index';
import type { LayoutPositionPlan } from '../src/interaction/position/tracker';
import type { Internals } from '../src/controller/core/internals';
import { buildLayoutActions, commitLayoutChange } from '../src/controller/facade/layout-actions';
import type { Emitter, RuntimeComponents } from '../src/controller/facade/types';

function createMocks(options?: {
  readonly setTypographyChanged?: boolean;
  readonly setSpreadModeChanged?: boolean;
  readonly currentSpread?: number;
  readonly totalSpreads?: number;
  readonly resolvedSpread?: number;
  readonly nativeAnnotationGeometry?: boolean;
}) {
  const getCanvasSize = vi.fn(() => ({ width: 800, height: 600 }));
  const setTypography = vi.fn(() => options?.setTypographyChanged ?? true);
  const setSpreadMode = vi.fn(() => options?.setSpreadModeChanged ?? true);
  const setTheme = vi.fn();
  const notifyActiveSpread = vi.fn();
  const updateLayout = vi.fn(() => false);
  const spreads = Array.from({ length: options?.totalSpreads ?? 3 }, (_, index) => ({ index }));
  const reader = {
    totalSpreads: spreads.length,
    spreads,
    chapterMap: new Map(),
    manifestHrefMap: new Map(),
    dpr: 2,
    getCanvasSize,
    getChapterTextIndices: vi.fn(() => new Map()),
    setTypography,
    setSpreadMode,
    setTheme,
    notifyActiveSpread,
    updateLayout,
    ...(options?.nativeAnnotationGeometry
      ? {
          interactions: {
            enabled: true,
            resolveExactSourceRange: () => Promise.resolve(undefined),
          },
        }
      : {}),
  };

  const setSize = vi.fn();
  const resize = vi.fn();
  const invalidateAllContent = vi.fn();
  const assignSlot = vi.fn();
  const reset = vi.fn();
  const scheduleComposite = vi.fn();
  let annotationStateAtComposite:
    | {
        readonly generation: number;
        readonly cacheSize: number;
        readonly missSize: number;
        readonly pendingSize: number;
        readonly resolvedCount: number;
      }
    | undefined;
  const resolve = vi.fn(() => options?.resolvedSpread);
  const getCurrent = vi.fn<() => ReadingPosition | null>(() => null);
  const getPreservableCurrent = vi.fn<() => ReadingPosition | null>(() => getCurrent());
  const positionIntent = { generation: 4 };
  const claimPositionIntent = vi.fn(() => positionIntent);
  const prepareLayoutCommit = vi.fn(
    (position: ReadingPosition | null | undefined): LayoutPositionPlan => ({
      kind: 'synchronous',
      intent: claimPositionIntent(),
      position: position === undefined ? getPreservableCurrent() : position,
    }),
  );
  const invalidateSelection = vi.fn();
  const coordState = {
    contentInteractionGeneration: 6,
    selectionProjectionTransfer: null,
    positionUpdateMode: { kind: 'capture' },
    resolvedAnnotations: [{}],
    nativeAnnotationGeometry: {
      generation: 4,
      cache: new Map([['source', {}]]),
      misses: new Set(['missing-source']),
      pending: new Map([['pending-source', Promise.resolve(undefined)]]),
    },
    nativeSearchGeometry: {
      alive: true,
      generation: 4,
      results: [],
      visible: null,
      cache: new Map(),
      misses: new Set(),
      pending: new Map(),
    },
  };
  const compositeNow = vi.fn(() => {
    annotationStateAtComposite = {
      generation: coordState.nativeAnnotationGeometry.generation,
      cacheSize: coordState.nativeAnnotationGeometry.cache.size,
      missSize: coordState.nativeAnnotationGeometry.misses.size,
      pendingSize: coordState.nativeAnnotationGeometry.pending.size,
      resolvedCount: coordState.resolvedAnnotations.length,
    };
  });
  const internals = {
    reader,
    currentSpread: options?.currentSpread ?? 1,
    renderScale: 1,
    options: {},
    engines: {
      selection: { invalidate: invalidateSelection },
      search: {},
      position: {
        getCurrent,
        getPreservableCurrent,
        resolve,
        claimIntent: claimPositionIntent,
        prepareLayoutCommit,
      },
    },
    coordState,
  } as unknown as Internals;

  const runtime = {
    surface: { setSize },
    pool: { resize, invalidateAllContent, assignSlot },
    td: { reset, viewportWidth: 0 },
    frameDriver: { scheduleComposite, compositeNow },
  } as unknown as RuntimeComponents;
  const emit = vi.fn();
  const emitter = { emit } as unknown as Emitter;

  return {
    reader,
    internals,
    runtime,
    emitter,
    spies: {
      setSize,
      resize,
      invalidateAllContent,
      assignSlot,
      reset,
      scheduleComposite,
      compositeNow,
      emit,
      notifyActiveSpread,
      setTypography,
      setTheme,
      resolve,
      getCurrent,
      getPreservableCurrent,
      claimPositionIntent,
      prepareLayoutCommit,
      positionIntent,
      invalidateSelection,
    },
    get annotationStateAtComposite() {
      return annotationStateAtComposite;
    },
  };
}

describe('buildLayoutActions', () => {
  it('forwards cleared theme overrides and invalidates rendered content', () => {
    const { internals, runtime, emitter, spies } = createMocks();
    const actions = buildLayoutActions(internals, emitter, runtime);

    actions.setTheme({ backgroundColor: null, foregroundColor: null });

    expect(spies.setTheme).toHaveBeenCalledWith({ backgroundColor: null, foregroundColor: null });
    expect(spies.invalidateAllContent).toHaveBeenCalledOnce();
    expect(spies.scheduleComposite).toHaveBeenCalledOnce();
  });

  it('refreshes layout state when typography changes commit synchronously', () => {
    const { reader, internals, runtime, emitter, spies } = createMocks();
    const actions = buildLayoutActions(internals, emitter, runtime);

    expect(actions.setTypography({ fontSize: 18, lineHeight: 1.6 })).toBe(true);

    expect(spies.setTypography).toHaveBeenCalledWith({ fontSize: 18, lineHeight: 1.6 });
    expect(spies.setSize).toHaveBeenCalledWith(800, 600, 2);
    expect(spies.resize).toHaveBeenCalledWith(800, 600, 2);
    expect(spies.invalidateAllContent).toHaveBeenCalledOnce();
    expect(spies.assignSlot).toHaveBeenCalledWith('curr', 1);
    expect(spies.reset).toHaveBeenCalledOnce();
    expect(spies.compositeNow).toHaveBeenCalledOnce();
    expect(spies.emit).toHaveBeenCalledWith('layoutChange', {
      spreads: reader.spreads,
      totalSpreads: reader.totalSpreads,
    });
    expect(spies.notifyActiveSpread).toHaveBeenCalledWith(1);
    expect(spies.invalidateSelection).toHaveBeenCalledOnce();
    expect(internals.coordState.contentInteractionGeneration).toBe(7);
  });

  it('invalidates native annotation geometry before compositing a replacement revision', () => {
    const fixture = createMocks({ nativeAnnotationGeometry: true });
    const actions = buildLayoutActions(fixture.internals, fixture.emitter, fixture.runtime);

    actions.setTypography({ fontSize: 18 });

    expect(fixture.annotationStateAtComposite).toEqual({
      generation: 5,
      cacheSize: 0,
      missSize: 0,
      pendingSize: 0,
      resolvedCount: 0,
    });
    expect(fixture.internals.coordState.nativeSearchGeometry.generation).toBe(5);
    expect(fixture.spies.emit).toHaveBeenCalledWith('annotationHover', {
      annotation: null,
      x: 0,
      y: 0,
    });
  });

  it('does nothing when typography overrides do not commit synchronously', () => {
    const { internals, runtime, emitter, spies } = createMocks({
      setTypographyChanged: false,
    });
    const actions = buildLayoutActions(internals, emitter, runtime);

    expect(actions.setTypography({ fontFamily: 'serif' })).toBe(false);

    expect(spies.setTypography).toHaveBeenCalledWith({ fontFamily: 'serif' });
    expect(spies.setSize).not.toHaveBeenCalled();
    expect(spies.invalidateAllContent).not.toHaveBeenCalled();
    expect(spies.compositeNow).not.toHaveBeenCalled();
    expect(spies.emit).not.toHaveBeenCalled();
  });

  it('clamps the current spread when repagination reduces the spread count', () => {
    const { reader, internals, runtime, emitter, spies } = createMocks({
      currentSpread: 3,
      totalSpreads: 1,
    });
    const actions = buildLayoutActions(internals, emitter, runtime);

    expect(actions.setTypography({ fontSize: 20 })).toBe(true);

    expect(internals.currentSpread).toBe(0);
    expect(spies.emit).toHaveBeenCalledWith('spreadChange', {
      spreadIndex: 0,
      spread: reader.spreads[0],
    });
  });

  it('projects the canonical position through the committed layout', () => {
    const { internals, runtime, emitter, spies } = createMocks({
      currentSpread: 0,
      resolvedSpread: 2,
    });
    const anchor: ReadingPosition = {
      projection: { spreadIndex: 0, pageIndex: 0 },
      progress: 0,
      timestamp: 1,
      locator: { spineIdref: 'chapter', chapterProgress: 0.5 },
    };
    spies.getCurrent.mockReturnValue(anchor);
    const actions = buildLayoutActions(internals, emitter, runtime);

    expect(actions.setTypography({ fontSize: 20 })).toBe(true);

    expect(spies.resolve).toHaveBeenCalledWith(anchor);
    expect(spies.claimPositionIntent).toHaveBeenCalledOnce();
    expect(internals.currentSpread).toBe(2);
    expect(internals.coordState.positionUpdateMode).toEqual({
      kind: 'preserve',
      position: anchor,
      intent: spies.positionIntent,
    });
  });

  it('uses the native frame spread committed atomically with a replacement revision', () => {
    const { reader, internals, runtime, emitter, spies } = createMocks({
      currentSpread: 1,
      totalSpreads: 4,
      resolvedSpread: 0,
    });
    const committedSpread = reader.spreads[3];
    if (!committedSpread) throw new Error('test spread missing');
    Object.assign(committedSpread, { left: { index: 3 } });
    const sourceLocator = {
      href: 'Text/chapter.xhtml',
      sourcePoint: { nodePath: [0, 1], textOffset: 12 },
    };
    const anchor: ReadingPosition = {
      sourceLocator,
      projection: { spreadIndex: 1, pageIndex: 1 },
      progress: 0.25,
      timestamp: 1,
    };
    spies.getCurrent.mockReturnValue(anchor);
    spies.prepareLayoutCommit.mockReturnValueOnce({ kind: 'portable' });

    commitLayoutChange(internals, emitter, runtime, undefined, 3);

    expect(spies.resolve).not.toHaveBeenCalled();
    expect(internals.currentSpread).toBe(3);
    expect(internals.coordState.positionUpdateMode).toEqual({ kind: 'skip', spreadIndex: 3 });
    expect(spies.notifyActiveSpread).toHaveBeenCalledWith(3);
  });

  it('installs position state before layout events and suppresses a stale spread event', () => {
    const fixture = createMocks({ currentSpread: 0, totalSpreads: 3 });
    const order: string[] = [];
    fixture.spies.prepareLayoutCommit.mockReturnValueOnce({ kind: 'portable' });
    fixture.spies.notifyActiveSpread.mockImplementation((spreadIndex: number) => {
      order.push(`notify:${String(spreadIndex)}`);
      expect(fixture.internals.coordState.positionUpdateMode).toEqual({
        kind: 'skip',
        spreadIndex: 1,
      });
      expect(fixture.spies.compositeNow).not.toHaveBeenCalled();
    });
    fixture.spies.emit.mockImplementation((event: string) => {
      order.push(event);
      if (event !== 'layoutChange') return;
      expect(fixture.spies.compositeNow).toHaveBeenCalledOnce();
      fixture.internals.currentSpread = 2;
    });

    commitLayoutChange(fixture.internals, fixture.emitter, fixture.runtime, undefined, 1);

    expect(fixture.internals.currentSpread).toBe(2);
    expect(order).toEqual(['notify:1', 'annotationHover', 'layoutChange']);
    expect(fixture.spies.emit).not.toHaveBeenCalledWith('spreadChange', expect.anything());
  });

  it('does not overwrite navigation triggered while invalidating the selection', () => {
    const fixture = createMocks({ currentSpread: 0, totalSpreads: 3 });
    const order: string[] = [];
    fixture.internals.coordState.selectionProjectionTransfer = {
      targetSpreadIndex: 1,
      gesture: { generation: 0 },
    };
    fixture.spies.prepareLayoutCommit.mockReturnValueOnce({ kind: 'portable' });
    fixture.spies.notifyActiveSpread.mockImplementation((spreadIndex: number) => {
      order.push(`notify:${String(spreadIndex)}`);
      expect(fixture.internals.currentSpread).toBe(1);
      expect(fixture.internals.coordState.selectionProjectionTransfer).toBeNull();
      expect(fixture.internals.coordState.positionUpdateMode).toEqual({
        kind: 'skip',
        spreadIndex: 1,
      });
      fixture.internals.currentSpread = 2;
    });
    fixture.spies.invalidateSelection.mockImplementation(() => {
      order.push('selection');
      expect(fixture.spies.notifyActiveSpread).not.toHaveBeenCalled();
    });
    fixture.spies.compositeNow.mockImplementation(() => {
      order.push('composite');
    });
    fixture.spies.emit.mockImplementation((event: string) => {
      order.push(event);
    });

    commitLayoutChange(fixture.internals, fixture.emitter, fixture.runtime, undefined, 1);

    expect(fixture.internals.currentSpread).toBe(2);
    expect(order).toEqual([
      'selection',
      'notify:1',
      'composite',
      'annotationHover',
      'layoutChange',
    ]);
    expect(fixture.spies.emit).not.toHaveBeenCalledWith('spreadChange', expect.anything());
  });

  it('does not reactivate the committed spread after selection invalidation redirects', () => {
    const fixture = createMocks({ currentSpread: 0, totalSpreads: 3 });
    fixture.spies.prepareLayoutCommit.mockReturnValueOnce({ kind: 'portable' });
    fixture.spies.invalidateSelection.mockImplementation(() => {
      fixture.internals.currentSpread = 2;
      fixture.reader.notifyActiveSpread(2);
    });

    commitLayoutChange(fixture.internals, fixture.emitter, fixture.runtime, undefined, 1);

    expect(fixture.internals.currentSpread).toBe(2);
    expect(fixture.spies.notifyActiveSpread).toHaveBeenCalledOnce();
    expect(fixture.spies.notifyActiveSpread).toHaveBeenCalledWith(2);
    expect(fixture.spies.notifyActiveSpread).not.toHaveBeenCalledWith(1);
  });

  it('clears native annotation state before hover listeners can redirect', () => {
    const fixture = createMocks({
      currentSpread: 0,
      totalSpreads: 3,
      nativeAnnotationGeometry: true,
    });
    const order: string[] = [];
    fixture.spies.prepareLayoutCommit.mockReturnValueOnce({ kind: 'portable' });
    fixture.spies.notifyActiveSpread.mockImplementation((spreadIndex: number) => {
      order.push(`notify:${String(spreadIndex)}`);
    });
    fixture.spies.emit.mockImplementation((event: string) => {
      order.push(event);
      if (event !== 'annotationHover') return;
      expect(fixture.internals.currentSpread).toBe(1);
      expect(fixture.internals.coordState.positionUpdateMode).toEqual({
        kind: 'skip',
        spreadIndex: 1,
      });
      expect(fixture.internals.coordState.resolvedAnnotations).toEqual([]);
      expect(fixture.internals.coordState.nativeAnnotationGeometry.cache.size).toBe(0);
      expect(fixture.spies.notifyActiveSpread).toHaveBeenCalledWith(1);
      fixture.internals.currentSpread = 2;
    });

    commitLayoutChange(fixture.internals, fixture.emitter, fixture.runtime, undefined, 1);

    expect(fixture.internals.currentSpread).toBe(2);
    expect(order).toEqual(['notify:1', 'annotationHover', 'layoutChange']);
    expect(fixture.spies.emit).not.toHaveBeenCalledWith('spreadChange', expect.anything());
  });

  it('does not preserve a stale current position after a preview navigation starts', () => {
    const { internals, runtime, emitter, spies } = createMocks({ currentSpread: 1 });
    spies.getCurrent.mockReturnValue({
      sourceLocator: { href: 'old.xhtml', progression: 0.5 },
      projection: { spreadIndex: 1, pageIndex: 1 },
      progress: 0.5,
      timestamp: 1,
    });
    spies.getPreservableCurrent.mockReturnValue(null);

    buildLayoutActions(internals, emitter, runtime).setTypography({ fontSize: 20 });

    expect(spies.prepareLayoutCommit).toHaveBeenCalledWith(null, 1);
    expect(spies.resolve).not.toHaveBeenCalled();
    expect(internals.coordState.positionUpdateMode).toEqual({ kind: 'capture' });
  });

  it('refreshes immediately when spread mode commits synchronously', () => {
    const { reader, internals, runtime, emitter, spies } = createMocks();
    const actions = buildLayoutActions(internals, emitter, runtime);

    actions.setSpreadMode('double');

    expect(reader.setSpreadMode).toHaveBeenCalledWith('double');
    expect(spies.invalidateAllContent).toHaveBeenCalledOnce();
    expect(spies.notifyActiveSpread).toHaveBeenCalledWith(1);
  });

  it('waits for the Rust reader layout callback when spread mode is asynchronous', () => {
    const { reader, internals, runtime, emitter, spies } = createMocks({
      setSpreadModeChanged: false,
    });
    const actions = buildLayoutActions(internals, emitter, runtime);

    actions.setSpreadMode('double');

    expect(reader.setSpreadMode).toHaveBeenCalledWith('double');
    expect(spies.invalidateAllContent).not.toHaveBeenCalled();
    expect(spies.emit).not.toHaveBeenCalled();
  });

  it('finishes a layout-owned preview after exact composite and before reentrant public events', () => {
    const fixture = createMocks({ currentSpread: 0, totalSpreads: 3 });
    const order: string[] = [];
    fixture.spies.prepareLayoutCommit.mockReturnValueOnce({ kind: 'portable' });
    fixture.spies.notifyActiveSpread.mockImplementation(() => {
      order.push('notify');
    });
    fixture.spies.compositeNow.mockImplementation(() => {
      order.push('composite');
    });
    fixture.spies.emit.mockImplementation((event: string) => {
      order.push(event);
    });
    const finish = vi.fn(() => {
      order.push('end');
      expect(fixture.internals.currentSpread).toBe(1);
      expect(fixture.spies.compositeNow).toHaveBeenCalledOnce();
    });
    Object.assign(fixture.runtime, {
      terminateChapterLocalForLayout: vi.fn(() => finish),
    });

    commitLayoutChange(fixture.internals, fixture.emitter, fixture.runtime, undefined, 1);

    expect(finish).toHaveBeenCalledOnce();
    expect(order).toEqual([
      'notify',
      'composite',
      'end',
      'annotationHover',
      'layoutChange',
      'spreadChange',
    ]);
  });

  it('releases a layout-owned preview even when an exact reader listener throws', () => {
    const fixture = createMocks({ currentSpread: 0, totalSpreads: 2 });
    const failure = new Error('reader listener failed');
    const finish = vi.fn();
    fixture.spies.prepareLayoutCommit.mockReturnValueOnce({ kind: 'portable' });
    fixture.spies.notifyActiveSpread.mockImplementation(() => {
      throw failure;
    });
    Object.assign(fixture.runtime, {
      terminateChapterLocalForLayout: vi.fn(() => finish),
    });

    expect(() => {
      commitLayoutChange(fixture.internals, fixture.emitter, fixture.runtime, undefined, 1);
    }).toThrow(failure);
    expect(finish).toHaveBeenCalledOnce();
  });

  it('composites render-scale exact content before completing a provisional transition', () => {
    const fixture = createMocks({ currentSpread: 1 });
    const order: string[] = [];
    fixture.spies.compositeNow.mockImplementation(() => {
      order.push('composite');
    });
    fixture.spies.notifyActiveSpread.mockImplementation(() => {
      order.push('notify');
    });
    const finish = vi.fn(() => {
      order.push('end');
    });
    Object.assign(fixture.runtime, {
      terminateChapterLocalForLayout: vi.fn(() => finish),
    });

    buildLayoutActions(fixture.internals, fixture.emitter, fixture.runtime).setRenderScale(2);

    expect(order).toEqual(['composite', 'notify', 'end']);
    expect(fixture.spies.scheduleComposite).not.toHaveBeenCalled();
    expect(fixture.internals.renderScale).toBe(2);
  });

  it('releases a layout-owned preview when render-scale canvas sync throws', () => {
    const fixture = createMocks({ currentSpread: 1 });
    const failure = new Error('pool resize failed');
    let finalizing = false;
    const finish = vi.fn(() => {
      finalizing = false;
    });
    Object.assign(fixture.runtime, {
      terminateChapterLocalForLayout: vi.fn(() => {
        finalizing = true;
        return finish;
      }),
    });
    fixture.spies.resize.mockImplementationOnce(() => {
      throw failure;
    });
    const actions = buildLayoutActions(fixture.internals, fixture.emitter, fixture.runtime);

    expect(() => {
      actions.setRenderScale(2);
    }).toThrow(failure);
    expect(finalizing).toBe(false);
    expect(finish).toHaveBeenCalledOnce();
    expect(fixture.spies.compositeNow).not.toHaveBeenCalled();

    expect(() => {
      actions.setRenderScale(3);
    }).not.toThrow();
    expect(finalizing).toBe(false);
    expect(finish).toHaveBeenCalledTimes(2);
    expect(fixture.spies.compositeNow).toHaveBeenCalledOnce();
  });
});
