import { describe, expect, it, vi } from 'vitest';
import type { Page, Spread } from '@ritojs/core';
import { createCoordinatorState } from '../src/controller/core';
import { coordinateOnSpreadRendered } from '../src/controller/wiring/spread';

const page: Page = {
  index: 0,
  bounds: { x: 0, y: 0, width: 300, height: 400 },
  content: [],
};
const spread: Spread = { index: 0, left: page };

function createReader() {
  return {
    measurer: {},
    getChapterTextIndices: vi.fn(() => new Map()),
    getLayoutGeometry: vi.fn(() => ({
      viewportWidth: 300,
      viewportHeight: 400,
      marginLeft: 20,
      marginTop: 20,
      spreadGap: 20,
    })),
  };
}

describe('coordinateOnSpreadRendered position updates', () => {
  it('projects a preserved position instead of recapturing from the rendered spread', () => {
    const state = createCoordinatorState();
    const position = {
      projection: { spreadIndex: 1, pageIndex: 1 },
      progress: 0.5,
      timestamp: 1,
    };
    const projected = { ...position, projection: { spreadIndex: 0, pageIndex: 0 }, progress: 0 };
    const tracker = {
      update: vi.fn(),
      project: vi.fn(() => projected),
      setCurrent: vi.fn(),
    };
    state.positionUpdateMode = { kind: 'preserve', position };

    coordinateOnSpreadRendered(
      0,
      spread,
      { selection: { setSpread: vi.fn() }, search: {}, position: tracker } as never,
      createReader() as never,
      state,
      1,
    );

    expect(tracker.update).not.toHaveBeenCalled();
    expect(tracker.project).toHaveBeenCalledWith(position);
    expect(tracker.setCurrent).toHaveBeenCalledWith(projected);
    expect(state.positionUpdateMode).toEqual({ kind: 'capture' });
  });

  it('skips position mutation for geometry-only spread refreshes', () => {
    const state = createCoordinatorState();
    const tracker = {
      update: vi.fn(),
      project: vi.fn(),
      setCurrent: vi.fn(),
    };
    state.positionUpdateMode = { kind: 'skip' };

    coordinateOnSpreadRendered(
      0,
      spread,
      { selection: { setSpread: vi.fn() }, search: {}, position: tracker } as never,
      createReader() as never,
      state,
      1,
    );

    expect(tracker.update).not.toHaveBeenCalled();
    expect(tracker.project).not.toHaveBeenCalled();
    expect(tracker.setCurrent).not.toHaveBeenCalled();
    expect(state.positionUpdateMode).toEqual({ kind: 'capture' });
  });
});
