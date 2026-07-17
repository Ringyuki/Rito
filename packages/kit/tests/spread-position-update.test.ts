import { describe, expect, it, vi } from 'vitest';
import type { Page, Spread } from '@ritojs/core';
import { createCoordinatorState } from '../src/controller/core';
import { coordinateOnSpreadRendered } from '../src/controller/wiring/spread';
import { createPositionTracker } from '../src/interaction/position/tracker';
import {
  captureSelectionGesture,
  consumeSelectionGestureProjection,
  registerSelectionInteractionOwner,
  withSelectionGestureProjection,
} from '../src/interaction/selection/selection-interaction-owner';

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
  it('applies a matching same-revision projection transfer without consuming its scope', () => {
    const state = createCoordinatorState();
    const token = {};
    const selectionRef: { current?: object } = {};
    const setSpread = vi.fn(() => {
      const selection = selectionRef.current;
      if (!selection) throw new Error('missing selection owner');
      expect(consumeSelectionGestureProjection(selection)).toBe(true);
    });
    const selection = registerSelectionInteractionOwner({ setSpread }, () => 1, {
      capture: () => token,
      owns: (candidate) => candidate === token,
      supportsProjectionTransfer: true,
    });
    selectionRef.current = selection;
    const gesture = captureSelectionGesture(selection);
    if (!gesture) throw new Error('missing selection gesture lease');
    const transfer = { targetSpreadIndex: 0, gesture };
    state.selectionProjectionTransfer = transfer;

    coordinateOnSpreadRendered(
      0,
      spread,
      { selection, search: {}, position: null } as never,
      createReader() as never,
      state,
      1,
    );

    expect(setSpread).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(state.selectionProjectionTransfer).toBe(transfer);
  });

  it('does not authorize projection for an owner without transfer capability', () => {
    const token = {};
    const selection = registerSelectionInteractionOwner({}, () => 1, {
      capture: () => token,
      owns: (candidate) => candidate === token,
    });
    const gesture = captureSelectionGesture(selection);
    if (!gesture) throw new Error('missing selection gesture lease');

    withSelectionGestureProjection(selection, gesture, () => {
      expect(consumeSelectionGestureProjection(selection)).toBe(false);
    });

    expect(consumeSelectionGestureProjection(selection)).toBe(false);
  });

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
    state.positionUpdateMode = { kind: 'skip', spreadIndex: 0 };

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

  it('does not let a stale bound skip supersede a newer portable intent', () => {
    const state = createCoordinatorState();
    const tracker = createPositionTracker(
      () =>
        ({
          pages: [page],
          spreads: [spread],
          chapterMap: new Map(),
        }) as never,
    );
    const staleIntent = tracker.claimIntent();
    const portableIntent = tracker.claimPortableIntent();
    state.positionUpdateMode = { kind: 'skip', spreadIndex: 0, intent: staleIntent };

    coordinateOnSpreadRendered(
      0,
      spread,
      { selection: { setSpread: vi.fn() }, search: {}, position: tracker } as never,
      createReader() as never,
      state,
      1,
    );

    expect(tracker.owns(portableIntent)).toBe(true);
    expect(tracker.getCurrent()).toBeNull();
    expect(state.positionUpdateMode).toEqual({ kind: 'capture' });
  });
});
