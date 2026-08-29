import type { Reader } from '@ritojs/core';
import { createFrameDriver, type FrameDriver } from '../driver/frame-driver';
import type { TransitionDriver } from '../driver/transition-driver';
import type { ContentRenderer, OverlayProvider, PageBufferPool } from '../painter/buffer-pool';
import type { DisplaySurface } from '../painter/display-surface';
import { commitCurrentSpread } from './core/current-spread';
import { publishSpreadChange } from './core/spread-change';
import { syncCanvasSize, type Internals } from './facade';
import type { Emitter, RuntimeComponents } from './facade/types';
import { createCoordinateMapper } from './geometry/coordinate-mapper';
import { mergeOverlayLayers } from './overlay/merger';
import { buildAdjacentOverlayData, buildOverlayData } from './overlay/projection';
import type { PrerenderScheduler } from './prerender';
import type { SettledEvent } from '../driver/types';

export {
  createProvisionalTransitionRuntime,
  type ProvisionalTransitionRuntime,
} from './provisional-transition-runtime';

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
    // Last-resort paint boundary: an exception here would leave the
    // spread permanently unpainted and wedge navigation into it, which
    // is the worst possible failure mode for a reader. Whatever the
    // canvas holds is shown, and the fault is reported loudly instead.
    try {
      return reader.renderSpreadTo(spreadIndex, context);
    } catch (error) {
      console.error(
        `[rito] spread ${String(spreadIndex)} paint failed; showing degraded content`,
        error,
      );
      return true;
    }
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
  handleProvisionalSettled?: (event: SettledEvent) => boolean,
): () => void {
  return transitionDriver.onSettled((event) => {
    if (handleProvisionalSettled?.(event)) {
      frameDriver.scheduleComposite();
      return;
    }
    if (event.committed) {
      if (event.direction === 'forward') pool.rotateForward();
      else pool.rotateBackward();
      commitCurrentSpread(internals, event.targetSpread, 'settle-commit');
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
  console.error(
    `[rito] page turn settled uncommitted, snapping back from spread ${String(internals.currentSpread)} to ${String(outgoing)}`,
  );
  commitCurrentSpread(internals, outgoing, 'settle-snap-back');
  reader.notifyActiveSpread(outgoing);
  if (internals.currentSpread !== outgoing) return;
  publishSpreadChange(emitter, reader, outgoing);
}
