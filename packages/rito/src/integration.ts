/**
 * Stable cross-package primitives used by `@ritojs/kit` and other controller
 * integrations. Application code should normally use the focused interaction
 * subpaths instead.
 */
export {
  buildHitMap,
  buildLinkMap,
  getSelectionRects,
  hitTestLink,
  type HitEntry,
  type HitMap,
  type LinkRegion,
} from './interaction/index';
export type { Rect } from './model/index';
export type { SourceRef } from './parser/index';
