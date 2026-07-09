import type { Reader } from '@ritojs/core/web';

import { createFrameDriver, type FrameDriver } from '../driver/frame-driver';
import type { TransitionDriver } from '../driver/transition-driver';
import type { ContentRenderer, PageBufferPool } from '../painter/buffer-pool';
import type { DisplaySurface } from '../painter/display-surface';
import type { OverlayLayer } from '../painter/types';
import type { Internals } from './core/index';
import { createCoordinateMapper } from './geometry/coordinate-mapper';
import { mergeOverlayLayers } from './overlay/merger';
import { buildAdjacentOverlayData, buildOverlayData } from './overlay/projection';

export interface RuntimeFrameParts {
  readonly contentRenderer: ContentRenderer;
  readonly frameDriver: FrameDriver;
}

export function createRuntimeFrameParts(
  reader: Reader,
  internals: Internals,
  surface: DisplaySurface,
  pool: PageBufferPool,
  transitionDriver: TransitionDriver,
): RuntimeFrameParts {
  const contentRenderer: ContentRenderer = (spreadIndex, context) => {
    reader.renderSpreadTo(spreadIndex, context);
  };
  const overlayProvider = buildOverlayProvider(
    internals,
    internals.engines,
    reader,
    internals.coordState,
  );
  const frameDriver = createFrameDriver({
    surface,
    pool,
    transitionDriver,
    contentRenderer,
    overlayProvider,
    getBackingRatio: () => reader.dpr * internals.renderScale,
  });
  return { contentRenderer, frameDriver };
}

function buildOverlayProvider(
  internals: Internals,
  engines: Internals['engines'],
  reader: Reader,
  coordState: Internals['coordState'],
): (spreadIndex: number) => readonly OverlayLayer[] {
  return (spreadIndex) => {
    const spread = reader.spreads[spreadIndex];
    if (!spread) return [];

    const isCurrent = spreadIndex === internals.currentSpread;
    const mapper =
      isCurrent && coordState.mapper
        ? coordState.mapper
        : createCoordinateMapper(reader.getLayoutGeometry(), spread, internals.renderScale);

    const data = isCurrent
      ? buildOverlayData(spread, engines, reader, coordState, mapper)
      : buildAdjacentOverlayData(spread, engines, reader, coordState, mapper);

    return mergeOverlayLayers(
      data.selectionRects,
      data.searchRects,
      data.activeSearchRects,
      data.annotationLayers,
    );
  };
}
