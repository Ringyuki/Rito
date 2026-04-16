import { describe, expect, it, vi } from 'vitest';
import { buildLayoutActions } from '../src/controller/facade/layout-actions';
import type { Internals } from '../src/controller/core/internals';
import type { Emitter, RuntimeComponents } from '../src/controller/facade/types';

function createMocks(opts?: {
  setTypographyChanged?: boolean;
  currentSpread?: number;
  totalSpreads?: number;
}) {
  const getCanvasSize = vi.fn(() => ({ width: 800, height: 600 }));
  const setTypography = vi.fn(() => opts?.setTypographyChanged ?? true);
  const notifyActiveSpread = vi.fn();
  const updateLayout = vi.fn();
  const setSpreadMode = vi.fn();
  const setTheme = vi.fn();
  const spreads = Array.from({ length: opts?.totalSpreads ?? 3 }, (_, index) => ({ index }));
  const reader = {
    totalSpreads: spreads.length,
    spreads,
    dpr: 2,
    getCanvasSize,
    setTypography,
    notifyActiveSpread,
    updateLayout,
    setSpreadMode,
    setTheme,
  };

  const setSize = vi.fn();
  const resize = vi.fn();
  const invalidateAllContent = vi.fn();
  const assignSlot = vi.fn();
  const reset = vi.fn();
  const scheduleComposite = vi.fn();
  const internals = {
    reader,
    currentSpread: opts?.currentSpread ?? 1,
    renderScale: 1,
    options: {},
    engines: {},
    coordState: {},
  } as unknown as Internals;

  const runtime = {
    surface: {
      setSize,
    },
    pool: {
      resize,
      invalidateAllContent,
      assignSlot,
    },
    td: {
      reset,
      viewportWidth: 0,
    },
    frameDriver: {
      scheduleComposite,
    },
  } as unknown as RuntimeComponents;

  const emit = vi.fn();
  const emitter = {
    emit,
  } as unknown as Emitter;

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
      emit,
      notifyActiveSpread,
      setTypography,
    },
  };
}

describe('buildLayoutActions', () => {
  it('refreshes layout state when typography changes trigger repagination', () => {
    const { reader, internals, runtime, emitter, spies } = createMocks();
    const actions = buildLayoutActions(internals, emitter, runtime);

    expect(actions.setTypography({ fontSize: 18, lineHeight: 1.6 })).toBe(true);

    expect(spies.setTypography).toHaveBeenCalledWith({ fontSize: 18, lineHeight: 1.6 });
    expect(spies.setSize).toHaveBeenCalledWith(800, 600, 2);
    expect(spies.resize).toHaveBeenCalledWith(800, 600, 2);
    expect(spies.invalidateAllContent).toHaveBeenCalledTimes(1);
    expect(spies.assignSlot).toHaveBeenCalledWith('curr', 1);
    expect(spies.reset).toHaveBeenCalledTimes(1);
    expect(spies.scheduleComposite).toHaveBeenCalledTimes(1);
    expect(spies.emit).toHaveBeenCalledWith('layoutChange', {
      spreads: reader.spreads,
      totalSpreads: reader.totalSpreads,
    });
    expect(spies.notifyActiveSpread).toHaveBeenCalledWith(1);
  });

  it('does nothing when typography overrides do not change layout', () => {
    const { internals, runtime, emitter, spies } = createMocks({ setTypographyChanged: false });
    const actions = buildLayoutActions(internals, emitter, runtime);

    expect(actions.setTypography({ fontFamily: 'serif' })).toBe(false);

    expect(spies.setTypography).toHaveBeenCalledWith({ fontFamily: 'serif' });
    expect(spies.setSize).not.toHaveBeenCalled();
    expect(spies.invalidateAllContent).not.toHaveBeenCalled();
    expect(spies.scheduleComposite).not.toHaveBeenCalled();
    expect(spies.emit).not.toHaveBeenCalled();
    expect(spies.notifyActiveSpread).not.toHaveBeenCalled();
  });

  it('emits spreadChange when repagination clamps the current spread', () => {
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
    expect(spies.notifyActiveSpread).toHaveBeenCalledWith(0);
  });
});
