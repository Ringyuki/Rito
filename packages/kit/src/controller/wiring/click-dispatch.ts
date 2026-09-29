import { findAnnotationHitAtPos, getAnnotationScreenCenter } from './annotation';
import type { AnnotationHit } from './annotation';
import type { WiringDeps } from '../core/wiring-deps';
import type { ContentHitKind } from '../types';
import { dispatchNativeClickTarget } from './native-click';
import { findNativeTargetAtPos } from './native-targets';
import { supersedePendingImageRequest } from './image-click';
import type { ReaderInteractionTarget } from '@ritojs/core';

/** What a click at a point would act on, and everything needed to act. */
export type ResolvedContentHit =
  | { readonly kind: 'annotation'; readonly annotation: AnnotationHit }
  | {
      readonly kind: 'link' | 'footnote' | 'image';
      readonly pageIndex: number;
      readonly target: ReaderInteractionTarget;
    };

/**
 * Resolves what sits under a spread-content point, without acting on it.
 *
 * Priority order:
 * 1. Annotation (existing highlight/note)
 * 2. Reader-owned page target: footnote, link, or image, in reverse paint order
 *
 * Both the dispatcher and `hitTestContent` read this one resolution, so a
 * synchronous query can never disagree with the event a click raises.
 * While a visual preview disables the reader's interactions there is
 * nothing to resolve: clicks are dropped rather than hit-tested against
 * stale geometry, and the query reports nothing for the same reason.
 */
export function resolveContentHit(
  pos: { x: number; y: number },
  deps: WiringDeps,
): ResolvedContentHit | undefined {
  if (!deps.reader.interactions?.enabled) return undefined;

  const annotation = findAnnotationHitAtPos(pos, deps);
  if (annotation) return { kind: 'annotation', annotation };

  const hit = findNativeTargetAtPos(pos, deps.coordState);
  if (!hit) return undefined;
  const kind = contentHitKind(hit.target);
  if (!kind) return undefined;
  return { kind, pageIndex: hit.pageIndex, target: hit.target };
}

/**
 * The event a click on this target raises. A pending footnote maps to
 * `'link'` because that is what the dispatcher does with it: its
 * definition is not indexed yet, so it acts as an ordinary link.
 */
function contentHitKind(
  target: ReaderInteractionTarget,
): 'link' | 'footnote' | 'image' | undefined {
  switch (target.kind) {
    case 'footnote':
      return 'footnote';
    case 'link':
    case 'footnotePending':
      return 'link';
    case 'image':
      return 'image';
    case 'text':
      // Text is the selection surface, not a click target.
      return undefined;
  }
}

/** Unified click target resolution and event dispatch. */
export function dispatchClick(pos: { x: number; y: number }, deps: WiringDeps): void {
  supersedePendingImageRequest(deps);
  const hit = resolveContentHit(pos, deps);
  if (!hit) return;
  if (hit.kind === 'annotation') {
    const center = getAnnotationScreenCenter(
      hit.annotation.annotation,
      deps.canvas,
      deps,
      hit.annotation.segment,
    );
    deps.emitter.emit('annotationClick', {
      annotation: hit.annotation.annotation,
      x: center.x,
      y: center.y,
    });
    return;
  }
  dispatchNativeClickTarget(hit.pageIndex, hit.target, deps);
}

/** The kind a click at this point would act on, or null for nothing. */
export function hitTestContentAt(
  pos: { x: number; y: number },
  deps: WiringDeps,
): ContentHitKind | null {
  return resolveContentHit(pos, deps)?.kind ?? null;
}
