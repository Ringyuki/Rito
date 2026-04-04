import type { Reader } from 'rito';
import type { Annotation } from 'rito/annotations';
import { bindClipboard } from 'rito/dom';
import { resolveAnnotationRects } from 'rito/advanced';
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

  let hoveredAnnId: string | null = null;

  disposables.add(
    bindPointerEvents(canvas, engines.selection, toContentArea, (pos) => {
      checkAnnotationClick(pos, deps);
    }),
  );
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

  // Annotation hover detection on pointermove
  const onMove = (e: PointerEvent): void => {
    const pos = toContentArea(e);
    const ann = findAnnotationAtPos(pos, deps);
    const newId = ann?.id ?? null;
    if (newId === hoveredAnnId) return;
    hoveredAnnId = newId;
    if (!ann) {
      emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
      return;
    }
    // Compute annotation center in screen coordinates (fixed positioning)
    const center = getAnnotationScreenCenter(ann, canvas, deps);
    emitter.emit('annotationHover', { annotation: ann, x: center.x, y: center.y });
  };
  canvas.addEventListener('pointermove', onMove);
  disposables.add(() => {
    canvas.removeEventListener('pointermove', onMove);
  });
}

function bindPointerEvents(
  canvas: HTMLCanvasElement,
  engine: SelectionEngine,
  toContentArea: (e: PointerEvent) => { x: number; y: number },
  onSingleClick?: (pos: { x: number; y: number }) => void,
): () => void {
  let downPos: { x: number; y: number } | null = null;

  const onDown = (e: PointerEvent): void => {
    if (e.button !== 0) return;
    const pos = toContentArea(e);
    downPos = pos;
    engine.handlePointerDown(pos);
  };
  const onMove = (e: PointerEvent): void => {
    engine.handlePointerMove(toContentArea(e));
  };
  const onUp = (e: PointerEvent): void => {
    const pos = toContentArea(e);
    engine.handlePointerUp(pos);
    // Detect single click (no significant drag)
    if (downPos && Math.abs(pos.x - downPos.x) < 3 && Math.abs(pos.y - downPos.y) < 3) {
      onSingleClick?.(pos);
    }
    downPos = null;
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

function checkAnnotationClick(pos: { x: number; y: number }, deps: WiringDeps): void {
  const ann = findAnnotationAtPos(pos, deps);
  if (ann) deps.emitter.emit('annotationClick', { annotation: ann });
}

/** Find the annotation at a content-area position, accounting for page offsets in double mode. */
function findAnnotationAtPos(
  pos: { x: number; y: number },
  deps: WiringDeps,
): Annotation | undefined {
  const { reader, engines, coordState, options } = deps;
  const spread = reader.spreads[deps.getCurrentSpread()];
  if (!spread) return undefined;

  const margin = options.margin ?? READER_DEFAULTS.margin;
  const gap = options.spreadGap ?? READER_DEFAULTS.spreadGap;
  const size = reader.getCanvasSize();
  const pageWidth = spread.right ? (size.width - gap) / 2 : size.width;
  const contentWidth = pageWidth - 2 * margin;
  const contentGap = margin + gap + margin;

  const entries: { page: typeof spread.left; offsetX: number }[] = [];
  if (spread.left) entries.push({ page: spread.left, offsetX: 0 });
  if (spread.right) entries.push({ page: spread.right, offsetX: contentWidth + contentGap });

  for (const { page, offsetX } of entries) {
    if (!page) continue;
    const localX = pos.x - offsetX;
    if (localX < 0 || localX > contentWidth) continue;
    const hitMap = coordState.hitMaps.get(page.index);
    if (!hitMap) continue;
    for (const ann of engines.annotation.getForPage(page.index)) {
      const data = resolveAnnotationRects(ann, hitMap, reader.measurer);
      for (const rect of data.rects) {
        if (
          localX >= rect.x &&
          localX <= rect.x + rect.width &&
          pos.y >= rect.y &&
          pos.y <= rect.y + rect.height
        ) {
          return ann;
        }
      }
    }
  }
  return undefined;
}

/** Get the center-top of an annotation in screen coordinates using canvas bounding rect. */
function getAnnotationScreenCenter(
  ann: Annotation,
  canvas: HTMLCanvasElement,
  deps: WiringDeps,
): { x: number; y: number } {
  const { reader, coordState, options } = deps;
  const margin = options.margin ?? READER_DEFAULTS.margin;
  const gap = options.spreadGap ?? READER_DEFAULTS.spreadGap;
  const scale = deps.getRenderScale();
  const spread = reader.spreads[deps.getCurrentSpread()];
  if (!spread) return { x: 0, y: 0 };

  // Find the exact page by annotation's pageIndex (not by iterating — blockIndex can collide)
  const isRight = spread.right?.index === ann.pageIndex;
  const page = isRight ? spread.right : spread.left;
  if (!page) return { x: 0, y: 0 };

  const hitMap = coordState.hitMaps.get(page.index);
  if (!hitMap) return { x: 0, y: 0 };

  const data = resolveAnnotationRects(ann, hitMap, reader.measurer);
  if (data.rects.length === 0) return { x: 0, y: 0 };

  const size = reader.getCanvasSize();
  const pageWidth = spread.right ? (size.width - gap) / 2 : size.width;
  const vpOffsetX = isRight ? pageWidth + gap : 0;

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity;
  for (const r of data.rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
  }

  const canvasRect = canvas.getBoundingClientRect();
  return {
    x: canvasRect.left + ((minX + maxX) / 2 + margin + vpOffsetX) * scale,
    y: canvasRect.top + (minY + margin) * scale,
  };
}
