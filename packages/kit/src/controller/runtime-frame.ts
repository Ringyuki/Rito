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
import { paintPagesOver } from './page-paint';
import { mergeOverlayLayers } from './overlay/merger';
import { buildOverlayData } from './overlay/projection';
import type { PrerenderScheduler } from './prerender';
import { transitionLifecycle } from './core/transition-lifecycle';

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
  emitter: Emitter,
): RuntimeFrameParts {
  const contentRenderer = createContentRenderer(reader, internals, emitter);
  const frameDriver = createFrameDriver({
    surface,
    pool,
    transitionDriver,
    contentRenderer,
    overlayProvider: buildOverlayProvider(internals, reader),
    getBackingRatio: () => reader.dpr * internals.renderScale,
    onTurnFrame: (frame) => {
      transitionLifecycle(emitter).progress(frame);
    },
  });
  return { contentRenderer, frameDriver };
}

export function createContentRenderer(
  reader: Reader,
  internals: Internals,
  emitter: Emitter,
): ContentRenderer {
  return (spreadIndex, page) => {
    // Last-resort paint boundary: an exception here would leave the
    // spread permanently unpainted and wedge navigation into it, which
    // is the worst possible failure mode for a reader. Whatever the
    // buffer holds is shown, and the fault is reported loudly instead.
    let painted: boolean;
    try {
      painted = reader.renderSpreadTo(spreadIndex, page.target);
    } catch (error) {
      console.error(
        `[rito] spread ${String(spreadIndex)} paint failed; showing degraded content`,
        error,
      );
      return true;
    }
    // The host draws over the engine's page, into the same picture.
    const painter = internals.options.paintPage;
    if (painted && painter) {
      paintPagesOver(
        painter,
        spreadIndex,
        page.hostLayer(),
        reader,
        internals.renderScale,
        (error) => {
          reportPainterError(emitter, error);
        },
      );
    }
    return painted;
  };
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
    painted: () => {
      runtime.frameDriver.warmTransition();
    },
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
  const prerender = (eagerPosition?: 'next' | 'prev'): void => {
    prerenderScheduler.schedule({
      getCurrentSpread: () => internals.currentSpread,
      isAnimating: () => transitionDriver.isAnimating,
      reader,
      pool,
      contentRenderer,
      ...(eagerPosition ? { eagerPosition } : {}),
      painted: () => {
        frameDriver.warmTransition();
      },
    });
  };
  // A turn cut into was settled while its picture still moved, when the
  // neighbours could not be painted ahead; once it is still they can be.
  const stopWatchingRest = transitionDriver.onRest(() => {
    prerender();
  });
  const stopWatchingSettled = transitionDriver.onSettled((event) => {
    if (event.committed) {
      if (event.direction === 'forward') pool.rotateForward();
      else pool.rotateBackward();
      commitCurrentSpread(internals, event.targetSpread, 'settle-commit');
      prerender(event.direction === 'forward' ? 'next' : 'prev');
    } else {
      restoreCanceledTransition(internals, emitter, reader, event.targetSpread);
    }
    // A listener above may have begun another turn, which ended this one itself.
    if (!transitionDriver.turning) {
      transitionLifecycle(emitter).end(event.committed ? 'committed' : 'cancelled');
    }
    frameDriver.scheduleComposite();
  });
  return () => {
    stopWatchingRest();
    stopWatchingSettled();
  };
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

    const data = buildOverlayData(
      spread,
      internals.engines,
      reader,
      internals.coordState,
      mapper,
      isCurrent,
    );

    return mergeOverlayLayers(
      data.selectionRects,
      data.searchRects,
      data.activeSearchRects,
      data.annotationLayers,
    );
  };
}

function reportPainterError(emitter: Emitter, error: unknown): void {
  try {
    emitter.emit('error', {
      message: error instanceof Error ? error.message : String(error),
      source: 'page-painter',
    });
  } catch {
    // A throwing error listener must not hold the page back either.
  }
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
