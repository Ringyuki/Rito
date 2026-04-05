import { bindClipboard } from 'rito/dom';
import type { DisposableCollection } from '../../utils/disposable';
import { handleLinkClick } from '../link-handler/index';
import { bindLinkCursor } from './link';
import { checkAnnotationClick, getAnnotationScreenCenter, findAnnotationAtPos } from './annotation';
import { toSpreadContent, type WiringDeps } from '../core/wiring-deps';
import { bindPointerEvents } from './pointer';

/**
 * Bind pointer events, clipboard, and link cursor to the canvas.
 *
 * Pointer coordinates are converted from display-css to spread-content via the
 * CoordinateMapper stored in coordState. All offset formulas live in the mapper.
 */
export function wireDomHelpers(deps: WiringDeps, disposables: DisposableCollection): void {
  const { canvas, engines, reader, emitter, coordState } = deps;

  const convert = (e: PointerEvent) => toSpreadContent(e, canvas, coordState);

  let hoveredAnnId: string | null = null;

  disposables.add(
    bindPointerEvents(canvas, engines.selection, convert, (pos) => {
      checkAnnotationClick(pos, deps);
    }),
  );
  disposables.add(bindClipboard(canvas, engines.selection));
  disposables.add(
    bindLinkCursor(canvas, coordState, convert, (region) => {
      handleLinkClick(region, reader, deps.setCurrentSpread, emitter);
    }),
  );

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
