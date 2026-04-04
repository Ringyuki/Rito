import type { Reader } from 'rito';
import { bindClipboard } from 'rito/dom';
import type { LinkRegion } from 'rito/advanced';
import type { SelectionEngine } from 'rito/selection';
import type { DisposableCollection } from '../utils/disposable';
import type { TypedEmitter } from '../utils/event-emitter';
import type { OverlayRenderer } from '../overlay/types';
import {
  coordinateOnSpreadRendered,
  refreshOverlay,
  type CoordinatorEngines,
  type CoordinatorState,
} from './engine-coordinator';
import { handleLinkClick } from './link-handler';
import { READER_DEFAULTS, type ControllerOptions, type ReaderControllerEvents } from './types';

export interface WiringDeps {
  reader: Reader;
  engines: CoordinatorEngines;
  emitter: TypedEmitter<ReaderControllerEvents>;
  overlay: OverlayRenderer;
  options: ControllerOptions;
  coordState: CoordinatorState;
  canvas: HTMLCanvasElement;
  getCurrentSpread: () => number;
  setCurrentSpread: (idx: number) => void;
  getRenderScale: () => number;
}

export function wireSpreadRendered(deps: WiringDeps, disposables: DisposableCollection): void {
  disposables.add(
    deps.reader.onSpreadRendered((idx, spread) => {
      coordinateOnSpreadRendered(
        idx,
        spread,
        deps.engines,
        deps.reader,
        deps.overlay,
        deps.coordState,
        deps.getRenderScale(),
        deps.options,
      );
    }),
  );
}

function refreshCurrentOverlay(deps: WiringDeps): void {
  const spread = deps.reader.spreads[deps.getCurrentSpread()];
  if (!spread) return;
  refreshOverlay(
    spread,
    deps.engines,
    deps.reader,
    deps.overlay,
    deps.coordState,
    deps.getRenderScale(),
    deps.options,
  );
}

export function wireEngineEvents(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter } = deps;

  disposables.add(
    engines.selection.onSelectionChange((range) => {
      emitter.emit('selectionChange', {
        range,
        text: engines.selection.getText(),
        rects: engines.selection.getRects(),
      });
      refreshCurrentOverlay(deps);
    }),
  );

  disposables.add(
    engines.search.onResultsChange((results) => {
      emitter.emit('searchResults', { results, activeIndex: engines.search.getActiveIndex() });
      refreshCurrentOverlay(deps);
    }),
  );

  disposables.add(
    engines.search.onActiveResultChange((idx) => {
      const results = engines.search.getResults();
      emitter.emit('searchActiveChange', { activeIndex: idx, result: results[idx] });
      refreshCurrentOverlay(deps);
    }),
  );

  disposables.add(
    engines.annotation.onAnnotationsChange((annotations) => {
      emitter.emit('annotationsChange', { annotations });
      refreshCurrentOverlay(deps);
    }),
  );
}

export function wirePositionTracker(deps: WiringDeps, disposables: DisposableCollection): void {
  const { engines, emitter, options } = deps;
  if (!engines.position) return;
  const tracker = engines.position;
  disposables.add(
    tracker.onPositionChange((position) => {
      emitter.emit('positionChange', { position });
      options.positionStorage?.save(tracker.serialize());
    }),
  );
}

/**
 * Bind pointer events, clipboard, and link cursor to the canvas.
 *
 * Pointer coordinates are converted from CSS display space to content-area space:
 *   contentX = (cssX / renderScale) - margin
 *   contentY = (cssY / renderScale) - margin
 *
 * The SelectionEngine receives a content-area-sized config (no margins) so that
 * resolvePageHit's boundary check and hitTest coordinates are both in content-area space.
 */
export function wireDomHelpers(deps: WiringDeps, disposables: DisposableCollection): void {
  const { canvas, engines, reader, emitter, coordState, options } = deps;
  const margin = options.margin ?? READER_DEFAULTS.margin;

  const toContentArea = (e: PointerEvent): { x: number; y: number } => {
    const rect = canvas.getBoundingClientRect();
    const scale = deps.getRenderScale();
    return {
      x: (e.clientX - rect.left) / scale - margin,
      y: (e.clientY - rect.top) / scale - margin,
    };
  };

  disposables.add(bindPointerEvents(canvas, engines.selection, toContentArea));
  disposables.add(bindClipboard(canvas, engines.selection));
  disposables.add(
    bindLinkCursor(
      canvas,
      () => coordState.linkRegions,
      toContentArea,
      (region) => {
        handleLinkClick(region, reader, deps.getCurrentSpread, deps.setCurrentSpread, emitter);
      },
    ),
  );
}

function bindPointerEvents(
  canvas: HTMLCanvasElement,
  engine: SelectionEngine,
  toContentArea: (e: PointerEvent) => { x: number; y: number },
): () => void {
  const onDown = (e: PointerEvent): void => {
    if (e.button === 0) engine.handlePointerDown(toContentArea(e));
  };
  const onMove = (e: PointerEvent): void => {
    engine.handlePointerMove(toContentArea(e));
  };
  const onUp = (e: PointerEvent): void => {
    engine.handlePointerUp(toContentArea(e));
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  return () => {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', onUp);
  };
}

function bindLinkCursor(
  canvas: HTMLCanvasElement,
  getRegions: () => readonly LinkRegion[],
  toContentArea: (e: PointerEvent) => { x: number; y: number },
  onClick?: (region: LinkRegion) => void,
): () => void {
  function hitTest(pos: { x: number; y: number }): LinkRegion | undefined {
    for (const r of getRegions()) {
      if (
        pos.x >= r.bounds.x &&
        pos.x <= r.bounds.x + r.bounds.width &&
        pos.y >= r.bounds.y &&
        pos.y <= r.bounds.y + r.bounds.height
      ) {
        return r;
      }
    }
    return undefined;
  }

  const onMove = (e: PointerEvent): void => {
    canvas.style.cursor = hitTest(toContentArea(e)) ? 'pointer' : '';
  };
  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0 || !onClick) return;
    const hit = hitTest(toContentArea(e));
    if (hit) onClick(hit);
  };

  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerdown', onDown);
  return () => {
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerdown', onDown);
    canvas.style.cursor = '';
  };
}
