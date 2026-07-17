import type { Reader } from '@ritojs/core';
import { createFrameDriver, type FrameDriver } from '../driver/frame-driver';
import type { TransitionDriver } from '../driver/transition-driver';
import type { ContentRenderer, OverlayProvider, PageBufferPool } from '../painter/buffer-pool';
import type { DisplaySurface } from '../painter/display-surface';
import { syncCanvasSize, type Internals } from './facade';
import type { Emitter, RuntimeComponents } from './facade/types';
import { createCoordinateMapper } from './geometry/coordinate-mapper';
import { mergeOverlayLayers } from './overlay/merger';
import { buildAdjacentOverlayData, buildOverlayData } from './overlay/projection';
import type { PrerenderScheduler } from './prerender';

interface RuntimeFrameParts {
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
    return reader.renderSpreadTo(spreadIndex, context);
  };
  const frameDriver = createFrameDriver({
    surface,
    pool,
    transitionDriver,
    contentRenderer,
    overlayProvider: buildOverlayProvider(internals, reader),
    getBackingRatio: () => reader.dpr * internals.renderScale,
  });
  return { contentRenderer, frameDriver };
}

export function startInitialControllerFrame(
  internals: Internals,
  runtime: RuntimeComponents,
  reader: Reader,
  contentRenderer: ContentRenderer,
): void {
  const spreadIndex = internals.currentSpread;
  syncCanvasSize(internals, runtime);
  runtime.pool.assignSlot('curr', spreadIndex);
  runtime.frameDriver.scheduleComposite();
  reader.notifyActiveSpread(spreadIndex);
  scheduleControllerPrerender(internals, runtime, contentRenderer);
}

export function scheduleControllerPrerender(
  internals: Internals,
  runtime: RuntimeComponents,
  contentRenderer: ContentRenderer,
): void {
  runtime.prerenderScheduler.schedule({
    getCurrentSpread: () => internals.currentSpread,
    isAnimating: () => runtime.td.isAnimating,
    reader: internals.reader,
    pool: runtime.pool,
    contentRenderer,
  });
}

export function wireSettledEvents(
  internals: Internals,
  transitionDriver: TransitionDriver,
  pool: PageBufferPool,
  emitter: Emitter,
  frameDriver: FrameDriver,
  reader: Reader,
  contentRenderer: ContentRenderer,
  prerenderScheduler: PrerenderScheduler,
): () => void {
  return transitionDriver.onSettled((event) => {
    if (event.committed) {
      if (event.direction === 'forward') pool.rotateForward();
      else pool.rotateBackward();
      internals.currentSpread = event.targetSpread;
      prerenderScheduler.schedule({
        getCurrentSpread: () => internals.currentSpread,
        isAnimating: () => transitionDriver.isAnimating,
        reader,
        pool,
        contentRenderer,
        eagerPosition: event.direction === 'forward' ? 'next' : 'prev',
      });
    } else {
      restoreCanceledTransition(internals, emitter, reader, event.targetSpread);
    }
    if (!transitionDriver.isAnimating) {
      emitter.emit('transitionEnd', { direction: event.direction });
    }
    frameDriver.scheduleComposite();
  });
}

function buildOverlayProvider(internals: Internals, reader: Reader): OverlayProvider {
  return (spreadIndex) => {
    const spread = reader.spreads[spreadIndex];
    if (!spread) return [];

    const isCurrent = spreadIndex === internals.currentSpread;
    const mapper =
      isCurrent && internals.coordState.mapper
        ? internals.coordState.mapper
        : createCoordinateMapper(reader.getLayoutGeometry(), spread, internals.renderScale);

    const data = isCurrent
      ? buildOverlayData(spread, internals.engines, reader, internals.coordState, mapper)
      : buildAdjacentOverlayData(spread, internals.engines, reader, internals.coordState, mapper);

    return mergeOverlayLayers(
      data.selectionRects,
      data.searchRects,
      data.activeSearchRects,
      data.annotationLayers,
    );
  };
}

function restoreCanceledTransition(
  internals: Internals,
  emitter: Emitter,
  reader: Reader,
  outgoing: number,
): void {
  if (internals.currentSpread === outgoing) return;
  internals.currentSpread = outgoing;
  reader.notifyActiveSpread(outgoing);
  if (internals.currentSpread !== outgoing) return;
  const spread = reader.spreads[outgoing];
  if (spread) emitter.emit('spreadChange', { spreadIndex: outgoing, spread });
}
