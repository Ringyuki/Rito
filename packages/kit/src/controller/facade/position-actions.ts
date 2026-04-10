import type { Internals, PositionActionsSlice } from './types';

export function buildPositionActions(internals: Internals): PositionActionsSlice {
  return {
    async restorePosition(): Promise<number | undefined> {
      const s = (await internals.options.positionStorage?.load()) ?? null;
      if (!s || !internals.engines.position) return undefined;
      return internals.engines.position.restore(s);
    },
    async savePosition(): Promise<void> {
      if (!internals.engines.position) return;
      await internals.options.positionStorage?.save(internals.engines.position.serialize());
    },
  };
}
