import type { Rect, ResolvedAnnotation, ResolvedAnnotationSegment } from '../../interaction/index';
import type { WiringDeps } from '../core/wiring-deps';

export interface AnnotationHit {
  readonly annotation: ResolvedAnnotation;
  readonly segment: ResolvedAnnotationSegment;
}

/** Where a hit annotation sits on screen, in the coordinates of the live canvas rect. */
export interface AnnotationScreenPlacement {
  /** Top centre of {@link screenBounds}. */
  readonly x: number;
  readonly y: number;
  /** Bounding box of the annotation's rects on the hit page. */
  readonly screenBounds: Rect;
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
  if (!deps.reader.interactions?.enabled) return undefined;
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
 * Projects the hit segment's bounding box to the screen. Only the hit page
 * counts: an annotation running onto the facing page is placed where it
 * was touched. All offset math is delegated to the mapper.
 */
export function getAnnotationScreenPlacement(
  hit: AnnotationHit,
  canvas: HTMLCanvasElement,
  deps: WiringDeps,
): AnnotationScreenPlacement {
  const { mapper } = deps.coordState;
  const bounds = boundingBox(hit.segment.rects);
  if (!mapper || !bounds) return { x: 0, y: 0, screenBounds: { x: 0, y: 0, width: 0, height: 0 } };
  const screenBounds = mapper.pageContentToScreen(
    hit.segment.pageIndex,
    bounds,
    canvas.getBoundingClientRect(),
  );
  return { x: screenBounds.x + screenBounds.width / 2, y: screenBounds.y, screenBounds };
}

function boundingBox(rects: readonly Rect[]): Rect | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.width);
    maxY = Math.max(maxY, r.y + r.height);
  }
  if (minX === Infinity) return undefined;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}
