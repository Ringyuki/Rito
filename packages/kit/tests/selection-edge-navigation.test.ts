import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createSelectionEdgeNavigation,
  SELECTION_EDGE_DWELL_MS,
} from '../src/controller/facade/selection-edge-navigation';

const surface = { left: 100, right: 500, top: 50, bottom: 350 } as DOMRect;

afterEach(() => {
  vi.useRealTimers();
});

describe('selection edge navigation', () => {
  it('turns once after a stationary edge dwell', () => {
    vi.useFakeTimers();
    let currentSpread = 0;
    const navigate = vi.fn((target: number) => {
      currentSpread = target;
      return 'committed' as const;
    });
    const edge = createSelectionEdgeNavigation({
      getSurfaceRect: () => surface,
      getCurrentSpread: () => currentSpread,
      getTotalSpreads: () => 3,
      navigate,
    });

    edge.update({ clientX: 496, clientY: 200 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS - 1);
    expect(navigate).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(
      1,
      1,
      { clientX: 496, clientY: 200 },
      expect.any(AbortSignal),
    );
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS * 2);
    expect(navigate).toHaveBeenCalledOnce();
  });

  it('cancels the dwell when the pointer leaves the edge or the session ends', () => {
    vi.useFakeTimers();
    const navigate = vi.fn(() => 'committed' as const);
    const edge = createSelectionEdgeNavigation({
      getSurfaceRect: () => surface,
      getCurrentSpread: () => 1,
      getTotalSpreads: () => 3,
      navigate,
    });

    edge.update({ clientX: 104, clientY: 200 });
    edge.update({ clientX: 300, clientY: 200 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    expect(navigate).not.toHaveBeenCalled();

    edge.update({ clientX: 496, clientY: 200 });
    edge.cancel();
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    expect(navigate).not.toHaveBeenCalled();
  });

  it('fails closed at the published boundaries and retries only a not-ready jump', () => {
    vi.useFakeTimers();
    let currentSpread = 0;
    const navigate = vi
      .fn()
      .mockReturnValueOnce('retry' as const)
      .mockImplementation((target: number) => {
        currentSpread = target;
        return 'committed' as const;
      });
    const edge = createSelectionEdgeNavigation({
      getSurfaceRect: () => surface,
      getCurrentSpread: () => currentSpread,
      getTotalSpreads: () => 2,
      navigate,
    });

    edge.update({ clientX: 104, clientY: 200 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    expect(navigate).not.toHaveBeenCalled();

    edge.update({ clientX: 496, clientY: 200 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    expect(navigate).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    expect(navigate).toHaveBeenCalledTimes(2);
    expect(currentSpread).toBe(1);
  });

  it('grows the next unpublished spread and resumes from a stationary point', async () => {
    vi.useFakeTimers();
    let currentSpread = 0;
    let totalSpreads = 1;
    let settleGrowth: ((outcome: 'retry') => void) | undefined;
    const navigate = vi.fn((target: number) => {
      if (target >= totalSpreads) {
        return new Promise<'retry'>((resolve) => {
          settleGrowth = resolve;
        });
      }
      currentSpread = target;
      return 'committed' as const;
    });
    const edge = createSelectionEdgeNavigation({
      getSurfaceRect: () => surface,
      getCurrentSpread: () => currentSpread,
      getTotalSpreads: () => totalSpreads,
      canGrowForward: () => true,
      navigate,
    });

    edge.update({ clientX: 496, clientY: 200 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    expect(navigate).toHaveBeenCalledOnce();

    totalSpreads = 2;
    settleGrowth?.('retry');
    await Promise.resolve();

    expect(navigate).toHaveBeenCalledTimes(2);
    expect(currentSpread).toBe(1);
  });

  it('aborts an unpublished-spread growth when the drag is cancelled', async () => {
    vi.useFakeTimers();
    let growthSignal: AbortSignal | undefined;
    let settleGrowth: ((outcome: 'retry') => void) | undefined;
    const navigate = vi.fn((_target, _direction, _point, signal: AbortSignal) => {
      growthSignal = signal;
      return new Promise<'retry'>((resolve) => {
        settleGrowth = resolve;
      });
    });
    const edge = createSelectionEdgeNavigation({
      getSurfaceRect: () => surface,
      getCurrentSpread: () => 0,
      getTotalSpreads: () => 1,
      canGrowForward: () => true,
      navigate,
    });

    edge.update({ clientX: 496, clientY: 200 });
    vi.advanceTimersByTime(SELECTION_EDGE_DWELL_MS);
    edge.cancel();

    expect(growthSignal?.aborted).toBe(true);
    settleGrowth?.('retry');
    await Promise.resolve();
    expect(navigate).toHaveBeenCalledOnce();
  });
});
