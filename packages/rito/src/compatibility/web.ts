// Deprecated compatibility Web Canvas preset for the legacy TypeScript core.
// Production reader code should import from `@ritojs/core`.

// ── Reader ─────────────────────────────────────────────────────────
export {
  createReader,
  type Reader,
  type ReaderOptions,
  type ReaderThemeOptions,
} from '../reference';

// ── Core conveniences re-exported for browser users ────────────────
export { loadEpub, paginate } from '../reference/ts-core/runtime/index';
export { buildSpreads, createLayoutConfig } from '../reference/ts-core/layout/index';
export type {
  ChapterRange,
  EpubDocument,
  LoadOptions,
  PaginationResult,
  ZipLimits,
} from '../reference/ts-core/runtime/index';
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
} from '../reference/ts-core/layout/index';

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
} from '../reference/ts-core/render/backends/canvas';
export { renderPage } from '../reference/ts-core/render/page';
export { getSpreadDimensions, render } from '../reference/ts-core/render/spread';
export type { RenderOptions } from '../reference/ts-core/render';

// ── Web resources ──────────────────────────────────────────────────
export {
  createLazyImageLoader,
  disposeAssets,
  loadAssets,
  loadFonts,
  loadImages,
  type LoadedAssets,
} from '../reference/ts-core/render/web';
export {
  disposeResources,
  paginateWithAssets,
  prepare,
  type Resources,
} from '../reference/reader/resources';
export {
  createWebFontRegistry,
  createWebImageAssetResolver,
  createWebImageDecoder,
} from '../reference/ts-core/render/assets/web';
export type { ImageObjectUrlProvider } from '../reference/ts-core/render/assets';

// ── Platform-neutral render contracts available from the Web entry ─
export {
  buildPageDisplayList,
  buildSpreadDisplayList,
} from '../reference/ts-core/render/display-list';
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
} from '../reference/ts-core/render';
