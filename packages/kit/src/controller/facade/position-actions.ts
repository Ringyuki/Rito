import type { Internals, Nav, PositionActionsSlice } from './types';

export function buildPositionActions(internals: Internals, nav: Nav): PositionActionsSlice {
  return {
    async restorePosition(): Promise<number | undefined> {
      const s = (await internals.options.positionStorage?.load()) ?? null;
      try {
        if (!s || !internals.engines.position) return undefined;
        const idx = internals.engines.position.restore(s);
        if (idx !== undefined) nav.jumpToSpread(idx);
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
  };
}
