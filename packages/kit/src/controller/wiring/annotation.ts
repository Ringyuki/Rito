import type { Annotation } from 'rito/annotations';
import { resolveAnnotationRects } from 'rito/advanced';
import type { WiringDeps } from '../core/wiring-deps';

export function checkAnnotationClick(pos: { x: number; y: number }, deps: WiringDeps): void {
  const ann = findAnnotationAtPos(pos, deps);
  if (ann) deps.emitter.emit('annotationClick', { annotation: ann });
}

/**
 * Find the annotation at a spread-content position.
 * Uses the mapper to resolve the page, then hit-tests annotation rects in page-content space.
 */
export function findAnnotationAtPos(
  pos: { x: number; y: number },
  deps: WiringDeps,
): Annotation | undefined {
  const { reader, engines, coordState } = deps;
  const { mapper } = coordState;
  if (!mapper) return undefined;

  const resolved = mapper.spreadContentToPage(pos.x, pos.y);
  if (!resolved) return undefined;

  const hitMap = coordState.hitMaps.get(resolved.pageIndex);
  if (!hitMap) return undefined;

  for (const ann of engines.annotation.getForPage(resolved.pageIndex)) {
    const data = resolveAnnotationRects(ann, hitMap, reader.measurer);
    for (const rect of data.rects) {
      if (
        resolved.x >= rect.x &&
        resolved.x <= rect.x + rect.width &&
        resolved.y >= rect.y &&
        resolved.y <= rect.y + rect.height
      ) {
        return ann;
      }
    }
  }
  return undefined;
}

/**
 * Get the center-top of an annotation in screen coordinates.
 * All offset math delegated to the mapper.
 */
export function getAnnotationScreenCenter(
  ann: Annotation,
  canvas: HTMLCanvasElement,
  deps: WiringDeps,
): { x: number; y: number } {
  const { reader, coordState } = deps;
  const { mapper } = coordState;
  if (!mapper) return { x: 0, y: 0 };

  const hitMap = coordState.hitMaps.get(ann.pageIndex);
  if (!hitMap) return { x: 0, y: 0 };

  const data = resolveAnnotationRects(ann, hitMap, reader.measurer);
  if (data.rects.length === 0) return { x: 0, y: 0 };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity;
  for (const r of data.rects) {
    if (r.x < minX) minX = r.x;
    if (r.y < minY) minY = r.y;
    if (r.x + r.width > maxX) maxX = r.x + r.width;
  }

  const centerRect = { x: (minX + maxX) / 2, y: minY, width: 0, height: 0 };
  const canvasRect = canvas.getBoundingClientRect();
  const screen = mapper.pageContentToScreen(ann.pageIndex, centerRect, canvasRect);
  return { x: screen.x, y: screen.y };
}
