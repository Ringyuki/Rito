export { createDisplaySurface, type DisplaySurface } from './display-surface';
export { paintOverlayInto } from './overlay-painter';
export {
  createPageBufferPool,
  type PageBufferPool,
  type ContentRenderer,
  type OverlayProvider,
} from './buffer-pool';
export type { OverlayLayer, PageBufferSlot, SlotPosition, Rect } from './types';
