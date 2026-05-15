import type { ReadingPosition } from '@ritojs/core/position';
import type { Internals, Nav, PositionActionsSlice } from './types';

export function buildPositionActions(internals: Internals, nav: Nav): PositionActionsSlice {
  return {
    async restorePosition(): Promise<number | undefined> {
      const s = (await internals.options.positionStorage?.load()) ?? null;
      try {
        if (!s || !internals.engines.position) return undefined;
        const idx = internals.engines.position.restore(s);
        if (idx !== undefined) {
          internals.coordState.positionUpdateMode = { kind: 'skip' };
          nav.jumpToSpread(idx);
        }
        return idx;
      } finally {
        // Mark restore as complete (even when no saved state was found) so the
        // position tracker may begin auto-persisting subsequent position changes.
        internals.restoreCompleted = true;
      }
    },
    async savePosition(): Promise<void> {
      if (!internals.engines.position) return;
      await internals.options.positionStorage?.save(internals.engines.position.serialize());
    },
    goToPosition(position: ReadingPosition): number | undefined {
      const tracker = internals.engines.position;
      if (!tracker) return undefined;
      const projected = tracker.project(position);
      const idx = projected.projection.spreadIndex;
      if (idx === internals.currentSpread) {
        tracker.setCurrent(projected);
        return idx;
      }
      internals.coordState.positionUpdateMode = { kind: 'preserve', position };
      nav.goToSpread(idx);
      return idx;
    },
  };
}
