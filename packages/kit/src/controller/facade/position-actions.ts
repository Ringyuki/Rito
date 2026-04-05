import type { Internals, PositionActionsSlice } from './types';

export function buildPositionActions(internals: Internals): PositionActionsSlice {
  return {
    restorePosition(): number | undefined {
      const s = internals.options.positionStorage?.load() ?? null;
      if (!s || !internals.engines.position) return undefined;
      return internals.engines.position.restore(s);
    },
    savePosition(): void {
      if (!internals.engines.position) return;
      internals.options.positionStorage?.save(internals.engines.position.serialize());
    },
  };
}
