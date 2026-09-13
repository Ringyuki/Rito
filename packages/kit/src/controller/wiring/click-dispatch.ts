import { findAnnotationHitAtPos, getAnnotationScreenCenter } from './annotation';
import type { WiringDeps } from '../core/wiring-deps';
import { dispatchNativeClickTarget } from './native-click';
import { findNativeTargetAtPos } from './native-targets';
import { supersedePendingImageRequest } from './image-click';

/**
 * Unified click target resolution and event dispatch.
 *
 * Priority order:
 * 1. Annotation (existing highlight/note)
 * 2. Reader-owned page target: footnote, link, or image, in reverse paint order
 *
 * Both desktop single-click and touch tap route through this function.
 * While a visual preview disables the reader's interactions, clicks are dropped
 * rather than hit-tested against stale geometry.
 */
export function dispatchClick(pos: { x: number; y: number }, deps: WiringDeps): void {
  supersedePendingImageRequest(deps);
  if (!deps.reader.interactions?.enabled) return;

  const annotationHit = findAnnotationHitAtPos(pos, deps);
  if (annotationHit) {
    const center = getAnnotationScreenCenter(
      annotationHit.annotation,
      deps.canvas,
      deps,
      annotationHit.segment,
    );
    deps.emitter.emit('annotationClick', {
      annotation: annotationHit.annotation,
      x: center.x,
      y: center.y,
    });
    return;
  }

  const hit = findNativeTargetAtPos(pos, deps.coordState);
  if (hit) dispatchNativeClickTarget(hit.pageIndex, hit.target, deps);
}
