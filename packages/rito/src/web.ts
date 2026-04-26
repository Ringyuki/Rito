// Web Canvas preset for `@ritojs/core`.
// Import platform-neutral contracts from `@ritojs/core`.

// ── Reader ─────────────────────────────────────────────────────────
export { createReader, type Reader, type ReaderOptions } from './reader';

// ── Core conveniences re-exported for browser users ────────────────
export { loadEpub, paginate } from './runtime/index';
export { buildSpreads, createLayoutConfig } from './layout/index';
export type { ChapterRange, EpubDocument, LoadOptions, PaginationResult } from './runtime/index';
export type {
  FontMetrics,
  FontMetricsProvider,
  LayoutConfig,
  LayoutConfigInput,
  Page,
  PaginationPolicy,
  Spread,
  TextMeasurer,
  TextMetrics,
} from './layout/index';

// ── Web Canvas rendering ───────────────────────────────────────────
export {
  canvasDisplayListRenderer,
  canvasTextMeasurementBackend,
  createTextMeasurer,
  type CachedTextMeasurer,
  type CanvasDisplayListOptions,
  type CanvasRenderOptions,
  type CanvasRenderingTarget,
  type CanvasTextMeasurementTarget,
} from './render/backends/canvas';
export { renderPage } from './render/page';
export { getSpreadDimensions, render } from './render/spread';
export type { RenderOptions } from './render';

// ── Web resources ──────────────────────────────────────────────────
export {
  createLazyImageLoader,
  disposeAssets,
  disposeResources,
  loadAssets,
  loadFonts,
  loadImages,
  paginateWithAssets,
  prepare,
  type LoadedAssets,
  type Resources,
} from './render/web';
export {
  createWebFontRegistry,
  createWebImageAssetResolver,
  createWebImageDecoder,
} from './render/assets/web';
export type { ImageObjectUrlProvider } from './render/assets';

// ── Platform-neutral render contracts available from the Web entry ─
export { buildPageDisplayList, buildSpreadDisplayList } from './render/display-list';
export type {
  DisplayList,
  DisplayListOptions,
  DisplayListRenderer,
  DrawCommand,
  ImageAssetResolver,
  ImageDecoder,
  ImageDimensions,
  ImageResource,
  TextMeasurementBackend,
} from './render';
