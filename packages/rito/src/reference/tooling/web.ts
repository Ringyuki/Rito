// TypeScript-reference tooling entry (golden pixel server, diagnostic
// renderer, Rust fixture export). Never shipped: the reference core is
// a parity oracle, not a product surface.

// ── Reader ─────────────────────────────────────────────────────────
export { createReader, type Reader, type ReaderOptions, type ReaderThemeOptions } from '../index';

// ── Core conveniences re-exported for browser users ────────────────
export { loadEpub, paginate } from '../ts-core/runtime/index';
export { buildSpreads, createLayoutConfig } from '../ts-core/layout/index';
export type {
  ChapterRange,
  EpubDocument,
  LoadOptions,
  PaginationResult,
  ZipLimits,
} from '../ts-core/runtime/index';
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
} from '../ts-core/layout/index';

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
} from '../ts-core/render/backends/canvas';
export { renderPage } from '../ts-core/render/page';
export { getSpreadDimensions, render } from '../ts-core/render/spread';
export type { RenderOptions } from '../ts-core/render';

// ── Web resources ──────────────────────────────────────────────────
export {
  createLazyImageLoader,
  disposeAssets,
  loadAssets,
  loadFonts,
  loadImages,
  type LoadedAssets,
} from '../ts-core/render/web';
export { disposeResources, paginateWithAssets, prepare, type Resources } from '../reader/resources';
export {
  createWebFontRegistry,
  createWebImageAssetResolver,
  createWebImageDecoder,
} from '../ts-core/render/assets/web';
export type { ImageObjectUrlProvider } from '../ts-core/render/assets';

// ── Platform-neutral render contracts available from the Web entry ─
export { buildPageDisplayList, buildSpreadDisplayList } from '../ts-core/render/display-list';
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
} from '../ts-core/render';
