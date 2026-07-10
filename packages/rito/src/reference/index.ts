/**
 * TypeScript reference implementation used as the migration oracle for the
 * Rust-backed core. This module is intentionally internal: do not expose it as
 * a stable package subpath, and do not import it from production reader code.
 */

// ── Reference reader ───────────────────────────────────────────────
export { createReader, createReader as createReferenceReader } from './reader';
export type { Reader, ReaderOptions, ReaderThemeOptions } from '../reader';

// ── Document / runtime ─────────────────────────────────────────────
export type { PackageMetadata, TocEntry } from './ts-core/parser/index';
export { loadEpub, paginate } from './ts-core/runtime/index';
export type {
  ChapterRange,
  EpubDocument,
  LoadOptions,
  PaginationResult,
} from './ts-core/runtime/index';
export type { FootnoteEntry } from './ts-core/runtime/footnote-extractor';

// Fixture-only oracle hooks. This reference entrypoint is internal and is not
// exposed through the published @ritojs/core package exports.
export {
  createFixtureChapterStyleContext,
  resolveFixtureChapterStyleTree,
} from './fixture-style-resolution';
export type { FixtureChapterStyleContext } from './fixture-style-resolution';

// ── Layout ─────────────────────────────────────────────────────────
export { buildSpreads, createLayoutConfig } from './ts-core/layout/index';
export type {
  FontMetrics,
  FontMetricsProvider,
  ImageDimensions,
  LayoutConfig,
  LayoutConfigInput,
  Page,
  PaginationPolicy,
  Spread,
  TextMeasurer,
  TextMetrics,
} from './ts-core/layout/index';

// ── Render contracts and reference Web helpers ─────────────────────
export {
  buildPageDisplayList,
  buildSpreadDisplayList,
  canvasDisplayListRenderer,
  canvasTextMeasurementBackend,
  collectPageImageSources,
  collectSpreadImageSources,
  createImageAssetResolver,
  createLazyImageLoader,
  createLazyImageLoaderWithDecoder,
  createTextMeasurer,
  loadFonts,
  loadFontsWithRegistry,
  loadImages,
  loadImagesWithDecoder,
} from './ts-core/render/index';
export type {
  BlockDecorationPaint,
  CanvasDisplayListOptions,
  CanvasRenderOptions,
  CanvasRenderingTarget,
  CanvasTextMeasurementTarget,
  DisplayList,
  DisplayListOptions,
  DisplayListRenderer,
  DrawCommand,
  FontRegistry,
  FontResource,
  ImageAssetResolver,
  ImageDecoder,
  ImageObjectUrlProvider,
  ImageResource,
  LazyImageLoader,
  TextMeasurementBackend,
} from './ts-core/render/index';

// ── Interaction / diagnostics ──────────────────────────────────────
export type { LogLevel } from './ts-core/utils/logger';
export type { ReadingPosition, TextPosition, TextRange } from './ts-core/interaction/index';
