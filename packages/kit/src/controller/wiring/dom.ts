import {
  bindClipboard,
  type ResolvedAnnotation,
  type ResolvedAnnotationSegment,
} from '../../interaction/index';
import type { DisposableCollection } from '../../utils/disposable';
import { bindLinkCursor } from './link';
import { findAnnotationHitAtPos, getAnnotationScreenCenter } from './annotation';
import { toSpreadContent, type WiringDeps } from '../core/wiring-deps';
import { bindPointerEvents } from './pointer';
import { dispatchClick } from './click-dispatch';
import type { PrimarySelectionDragNavigation } from './selection-drag';

/**
 * Bind pointer events, clipboard, and link cursor to the canvas.
 *
 * Desktop single-clicks go through `dispatchClick()` for unified
 * annotation / footnote / link / image handling.
 */
export function wireDomHelpers(
  deps: WiringDeps,
  disposables: DisposableCollection,
  selectionNavigation?: PrimarySelectionDragNavigation,
): void {
  const { canvas, engines, coordState } = deps;

  const convert = (e: PointerEvent) => toSpreadContent(e, canvas, coordState);

  // Pointer events: selection engine + single-click dispatch
  disposables.add(
    bindPointerEvents(
      canvas,
      engines.selection,
      convert,
      (pos) => {
        dispatchClick(pos, deps);
      },
      selectionNavigation,
    ),
  );
  disposables.add(bindClipboard(canvas, engines.selection));

  // Link cursor (hover only — clicks handled by dispatchClick above)
  disposables.add(bindLinkCursor(canvas, coordState, convert, deps.reader));
  disposables.add(bindAnnotationHover(deps, convert));
}

function bindAnnotationHover(
  deps: WiringDeps,
  convert: (event: PointerEvent) => { readonly x: number; readonly y: number },
): () => void {
  const { canvas, emitter } = deps;
  let hoveredAnnotation: ResolvedAnnotation | null = null;
  let hoveredSegment: ResolvedAnnotationSegment | null = null;
  const onMove = (e: PointerEvent): void => {
    const pos = convert(e);
    const hit = findAnnotationHitAtPos(pos, deps);
    const nextAnnotation = hit?.annotation ?? null;
    const nextSegment = hit?.segment ?? null;
    if (nextAnnotation === hoveredAnnotation && nextSegment === hoveredSegment) return;
    hoveredAnnotation = nextAnnotation;
    hoveredSegment = nextSegment;
    if (!hit) {
      emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
      return;
    }
    const center = getAnnotationScreenCenter(hit.annotation, canvas, deps, hit.segment);
    emitter.emit('annotationHover', {
      annotation: hit.annotation,
      x: center.x,
      y: center.y,
    });
  };
  const remove = (): void => {
    canvas.removeEventListener('pointermove', onMove);
  };
  canvas.addEventListener('pointermove', onMove);
  return remove;
}
