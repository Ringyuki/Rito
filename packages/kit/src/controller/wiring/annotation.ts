import type { ResolvedAnnotation } from '@rito/core/annotations';
import type { WiringDeps } from '../core/wiring-deps';

export function checkAnnotationClick(pos: { x: number; y: number }, deps: WiringDeps): void {
  const ann = findAnnotationAtPos(pos, deps);
  if (ann) deps.emitter.emit('annotationClick', { annotation: ann });
}

/**
 * Find the resolved annotation at a spread-content position.
 * Uses the mapper to resolve the page, then hit-tests resolved segment rects
 * in page-content space.
 */
export function findAnnotationAtPos(
  pos: { x: number; y: number },
  deps: WiringDeps,
): ResolvedAnnotation | undefined {
  const { coordState } = deps;
  const { mapper } = coordState;
  if (!mapper) return undefined;

  const resolved = mapper.spreadContentToPage(pos.x, pos.y);
  if (!resolved) return undefined;

  for (const ra of coordState.resolvedAnnotations) {
    if (ra.status === 'orphaned') continue;
    for (const seg of ra.segments) {
      if (seg.pageIndex !== resolved.pageIndex) continue;
      for (const rect of seg.rects) {
        if (
          resolved.x >= rect.x &&
          resolved.x <= rect.x + rect.width &&
          resolved.y >= rect.y &&
          resolved.y <= rect.y + rect.height
        ) {
          return ra;
        }
      }
    }
  }
  return undefined;
}

/**
 * Get the center-top of a resolved annotation in screen coordinates.
 * All offset math delegated to the mapper.
 */
export function getAnnotationScreenCenter(
  ann: ResolvedAnnotation,
  canvas: HTMLCanvasElement,
  deps: WiringDeps,
): { x: number; y: number } {
  const { coordState } = deps;
  const { mapper } = coordState;
  if (!mapper) return { x: 0, y: 0 };

  if (ann.segments.length === 0) return { x: 0, y: 0 };

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity;
  let firstPageIndex = ann.segments[0]?.pageIndex ?? 0;

  for (const seg of ann.segments) {
    for (const r of seg.rects) {
      if (r.x < minX) {
        minX = r.x;
        firstPageIndex = seg.pageIndex;
      }
      if (r.y < minY) minY = r.y;
      if (r.x + r.width > maxX) maxX = r.x + r.width;
    }
  }

  if (minX === Infinity) return { x: 0, y: 0 };

  const centerRect = { x: (minX + maxX) / 2, y: minY, width: 0, height: 0 };
  const canvasRect = canvas.getBoundingClientRect();
  const screen = mapper.pageContentToScreen(firstPageIndex, centerRect, canvasRect);
  return { x: screen.x, y: screen.y };
}
