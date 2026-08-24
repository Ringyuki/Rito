import type { Spread } from '@ritojs/core';
import type { WiringDeps } from '../core/wiring-deps';
import {
  scheduleNativeSearchGeometryForSpread,
  usesNativeSearchGeometry,
} from '../search-resolution';

export function scheduleNativeSearchForCurrentSpread(deps: WiringDeps): void {
  const spread = deps.reader.spreads[deps.getCurrentSpread()];
  if (spread) scheduleNativeSearchForSpread(spread, deps);
}

export function scheduleNativeSearchForSpread(spread: Spread, deps: WiringDeps): void {
  if (!usesNativeSearchGeometry(deps.reader)) return;
  scheduleNativeSearchGeometryForSpread(
    spread,
    deps.reader,
    deps.coordState,
    () => {
      deps.frameDriver.markAllOverlaysDirty();
    },
    (error) => {
      deps.emitter.emit('error', {
        message: error instanceof Error ? error.message : String(error),
        source: 'native-search-geometry',
      });
    },
  );
}
