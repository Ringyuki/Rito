import { describe, expect, it, vi } from 'vitest';
import type { ReadingPosition } from '../src/interaction/index';
import type { Internals } from '../src/controller/core/internals';
import { buildLayoutActions } from '../src/controller/facade/layout-actions';
import type { Emitter, RuntimeComponents } from '../src/controller/facade/types';

function createMocks(options?: {
  readonly setTypographyChanged?: boolean;
  readonly setLineBreakingChanged?: boolean;
  readonly setSpreadModeChanged?: boolean;
  readonly currentSpread?: number;
  readonly totalSpreads?: number;
  readonly resolvedSpread?: number;
}) {
  const getCanvasSize = vi.fn(() => ({ width: 800, height: 600 }));
  const setTypography = vi.fn(() => options?.setTypographyChanged ?? true);
  const setLineBreaking = vi.fn(() => options?.setLineBreakingChanged ?? true);
  const setSpreadMode = vi.fn(() => options?.setSpreadModeChanged ?? true);
  const setTheme = vi.fn();
  const notifyActiveSpread = vi.fn();
  const updateLayout = vi.fn(() => false);
  const spreads = Array.from({ length: options?.totalSpreads ?? 3 }, (_, index) => ({ index }));
  const pages = spreads.map((_, index) => ({ index }));
  const reader = {
    totalSpreads: spreads.length,
    spreads,
    pages,
    chapterMap: new Map(),
    manifestHrefMap: new Map(),
    dpr: 2,
    getCanvasSize,
    getChapterTextIndices: vi.fn(() => new Map()),
    setTypography,
    setLineBreaking,
    setSpreadMode,
    setTheme,
    notifyActiveSpread,
    updateLayout,
  };

  const setSize = vi.fn();
  const resize = vi.fn();
  const invalidateAllContent = vi.fn();
  const assignSlot = vi.fn();
  const reset = vi.fn();
  const scheduleComposite = vi.fn();
  const compositeNow = vi.fn();
  const setPages = vi.fn();
  const resolve = vi.fn(() => options?.resolvedSpread);
  const getCurrent = vi.fn<() => ReadingPosition | null>(() => null);
  const internals = {
    reader,
    currentSpread: options?.currentSpread ?? 1,
    renderScale: 1,
    options: {},
    engines: {
      search: { setPages },
      position: { getCurrent, resolve },
    },
    coordState: { positionUpdateMode: { kind: 'capture' } },
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
      setLineBreaking,
      setTheme,
      setPages,
      resolve,
      getCurrent,
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
    expect(spies.setPages).toHaveBeenCalledWith(reader.pages);
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

  it('refreshes layout state when line breaking commits synchronously', () => {
    const { reader, internals, runtime, emitter, spies } = createMocks();
    const actions = buildLayoutActions(internals, emitter, runtime);

    expect(actions.setLineBreaking('optimal')).toBe(true);

    expect(spies.setLineBreaking).toHaveBeenCalledWith('optimal');
    expect(spies.emit).toHaveBeenCalledWith('layoutChange', {
      spreads: reader.spreads,
      totalSpreads: reader.totalSpreads,
    });
  });

  it('does nothing when line breaking waits for an async commit', () => {
    const { internals, runtime, emitter, spies } = createMocks({
      setLineBreakingChanged: false,
    });
    const actions = buildLayoutActions(internals, emitter, runtime);

    expect(actions.setLineBreaking('greedy')).toBe(false);
    expect(spies.setSize).not.toHaveBeenCalled();
    expect(spies.invalidateAllContent).not.toHaveBeenCalled();
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
    expect(internals.currentSpread).toBe(2);
    expect(internals.coordState.positionUpdateMode).toEqual({
      kind: 'preserve',
      position: anchor,
    });
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
});
