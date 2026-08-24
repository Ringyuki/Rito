import type { ResolvedAnnotation, ResolvedAnnotationSegment } from '../../interaction/index';
import type { WiringDeps } from '../core/wiring-deps';
import { usesNativeAnnotationGeometry } from '../annotation-resolution';

export interface AnnotationHit {
  readonly annotation: ResolvedAnnotation;
  readonly segment: ResolvedAnnotationSegment;
}

export function checkAnnotationClick(pos: { x: number; y: number }, deps: WiringDeps): void {
  const hit = findAnnotationHitAtPos(pos, deps);
  if (!hit) return;
  const center = getAnnotationScreenCenter(hit.annotation, deps.canvas, deps, hit.segment);
  deps.emitter.emit('annotationClick', {
    annotation: hit.annotation,
    x: center.x,
    y: center.y,
  });
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
  return findAnnotationHitAtPos(pos, deps)?.annotation;
}

export function findAnnotationHitAtPos(
  pos: { x: number; y: number },
  deps: WiringDeps,
): AnnotationHit | undefined {
  const { coordState } = deps;
  if (usesNativeAnnotationGeometry(deps.reader) && !deps.reader.interactions?.enabled) {
    return undefined;
  }
  const { mapper } = coordState;
  if (!mapper) return undefined;

  const resolved = mapper.spreadContentToPage(pos.x, pos.y);
  if (!resolved) return undefined;

  for (let annotationIndex = coordState.resolvedAnnotations.length - 1; annotationIndex >= 0; ) {
    const ra = coordState.resolvedAnnotations[annotationIndex];
    annotationIndex -= 1;
    if (!ra) continue;
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
          return { annotation: ra, segment: seg };
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
  hitSegment?: ResolvedAnnotationSegment,
): { x: number; y: number } {
  const { coordState } = deps;
  const { mapper } = coordState;
  if (!mapper) return { x: 0, y: 0 };

  if (ann.segments.length === 0) return { x: 0, y: 0 };

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  const segments = hitSegment ? [hitSegment] : ann.segments.slice(0, 1);
  const firstPageIndex = segments[0]?.pageIndex ?? 0;

  for (const seg of segments) {
    for (const r of seg.rects) {
      if (r.x < minX) minX = r.x;
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
