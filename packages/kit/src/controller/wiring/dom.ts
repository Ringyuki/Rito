import { bindClipboard } from '@rito/core/dom';
import type { DisposableCollection } from '../../utils/disposable';
import { bindLinkCursor } from './link';
import { findAnnotationAtPos, getAnnotationScreenCenter } from './annotation';
import { toSpreadContent, type WiringDeps } from '../core/wiring-deps';
import { bindPointerEvents } from './pointer';
import { dispatchClick } from './click-dispatch';

/**
 * Bind pointer events, clipboard, and link cursor to the canvas.
 *
 * Desktop single-clicks go through `dispatchClick()` for unified
 * annotation / footnote / link / image handling.
 */
export function wireDomHelpers(deps: WiringDeps, disposables: DisposableCollection): void {
  const { canvas, engines, emitter, coordState } = deps;

  const convert = (e: PointerEvent) => toSpreadContent(e, canvas, coordState);

  let hoveredAnnId: string | null = null;

  // Pointer events: selection engine + single-click dispatch
  disposables.add(
    bindPointerEvents(canvas, engines.selection, convert, (pos) => {
      dispatchClick(pos, deps);
    }),
  );
  disposables.add(bindClipboard(canvas, engines.selection));

  // Link cursor (hover only — clicks handled by dispatchClick above)
  disposables.add(bindLinkCursor(canvas, coordState, convert));

  // Annotation hover tracking
  const onMove = (e: PointerEvent): void => {
    const pos = convert(e);
    const ann = findAnnotationAtPos(pos, deps);
    const newId = ann?.id ?? null;
    if (newId === hoveredAnnId) return;
    hoveredAnnId = newId;
    if (!ann) {
      emitter.emit('annotationHover', { annotation: null, x: 0, y: 0 });
      return;
    }
    const center = getAnnotationScreenCenter(ann, canvas, deps);
    emitter.emit('annotationHover', { annotation: ann, x: center.x, y: center.y });
  };
  canvas.addEventListener('pointermove', onMove);
  disposables.add(() => {
    canvas.removeEventListener('pointermove', onMove);
  });
}
