// Rito — Canvas-based EPUB rendering library.
// Use `createReader()` for the standard flow, or import primitives for custom pipelines.
// Internal APIs (parser, style resolver, layout engine) are in `rito/advanced`.

// ── Primary API ────────────────────────────────────────────────────
export { createReader, type Reader, type ReaderOptions } from './reader';

// ── Types (commonly needed with Reader) ────────────────────────────
export type { PackageMetadata, TocEntry } from './parser/index';
export type { ChapterRange } from './runtime/index';
export type { Page, Spread } from './layout/index';

// ── Primitives (still available from main entry for convenience) ──
export { loadEpub } from './runtime/index';
export {
  prepare,
  loadAssets,
  paginateWithAssets,
  disposeAssets,
  disposeResources,
  type LoadedAssets,
  type Resources,
} from './render/index';
export { render } from './render/index';
export { getSpreadDimensions } from './render/index';
export { paginate, paginateWithMeta } from './runtime/index';
export { buildSpreads } from './layout/index';
export { createLayoutConfig } from './layout/index';
export { createTextMeasurer } from './render/index';
export { findPageForTocEntry } from './runtime/index';
export { loadFonts } from './render/index';
export { loadImages } from './render/index';
export { createLazyImageLoader, type LazyImageLoader } from './render/index';
export type { EpubDocument, LoadOptions, PaginationResult } from './runtime/index';
export type { LayoutConfig, LayoutConfigInput } from './layout/index';
export type { TextMeasurer, TextMetrics } from './layout/index';
export type { RenderOptions } from './render/index';
export { paginateInWorker } from './workers/worker-paginator';
