// Rito — platform-neutral EPUB rendering core.
// Web Canvas preset APIs live in `@ritojs/core/web`.
// Internal APIs (parser, style resolver, layout engine) are in `@ritojs/core/advanced`.

// ── Document / runtime ─────────────────────────────────────────────
export type { PackageMetadata, TocEntry } from './parser/index';
export { paginate } from './runtime/index';
export { loadEpub } from './runtime/index';
export type { ChapterRange, EpubDocument, LoadOptions, PaginationResult } from './runtime/index';
export type { FootnoteEntry } from './runtime/footnote-extractor';

// ── Layout ─────────────────────────────────────────────────────────
export { buildSpreads } from './layout/index';
export { createLayoutConfig } from './layout/index';
export type {
  ImageDimensions,
  LayoutConfig,
  LayoutConfigInput,
  Page,
  PaginationPolicy,
  Spread,
} from './layout/index';
export type { FontMetrics, FontMetricsProvider, TextMeasurer, TextMetrics } from './layout/index';

// ── Platform-neutral render contracts ──────────────────────────────
export { buildPageDisplayList, buildSpreadDisplayList } from './render/display-list';
export type {
  BlockDecorationPaint,
  DisplayList,
  DisplayListOptions,
  DrawCommand,
} from './render/display-list';
export type { DisplayListRenderer, TextMeasurementBackend } from './render/backends';

// ── Resource adapters ──────────────────────────────────────────────
export { createImageAssetResolver } from './render/assets/image-asset-resolver';
export { loadFontsWithRegistry } from './render/assets/font-loader';
export { loadImagesWithDecoder } from './render/assets/image-loader';
export { createLazyImageLoaderWithDecoder } from './render/assets/lazy-image-loader';
export { collectPageImageSources, collectSpreadImageSources } from './render/assets/image-sources';
export type {
  FontRegistry,
  FontResource,
  ImageAssetResolver,
  ImageDecoder,
  ImageResource,
} from './render/assets/types';
export type { LazyImageLoader } from './render/assets/lazy-image-loader';

// ── Interaction / diagnostics ──────────────────────────────────────
export type { LogLevel } from './utils/logger';
export type { ReadingPosition, TextPosition, TextRange } from './interaction/index';
