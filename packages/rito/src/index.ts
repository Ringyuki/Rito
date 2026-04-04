// Rito — Canvas-based EPUB rendering library.
// Use `createReader()` for the standard flow, or import primitives for custom pipelines.
// Internal APIs (parser, style resolver, layout engine) are in `rito/advanced`.

// ── Primary API ────────────────────────────────────────────────────
export { createReader, type Reader, type ReaderOptions } from './reader';

// ── Types (commonly needed with Reader) ────────────────────────────
export type { PackageMetadata, TocEntry } from './parser/index';
export type { ChapterRange } from './runtime/index';
export type { Page, Spread } from './layout/index';
export type { LogLevel } from './utils/logger';
export type { TextRange, TextPosition, ReadingPosition } from './interaction/index';

// ── Stable high-level primitives ───────────────────────────────────
export { loadEpub } from './runtime/index';
export { prepare, disposeResources } from './render/index';
export { render } from './render/index';
export { getSpreadDimensions } from './render/index';
export { paginate } from './runtime/index';
export { buildSpreads } from './layout/index';
export { createLayoutConfig } from './layout/index';
export { createTextMeasurer } from './render/index';
export type { EpubDocument, LoadOptions, PaginationResult } from './runtime/index';
export type { LayoutConfig, LayoutConfigInput } from './layout/index';
export type { TextMeasurer, TextMetrics } from './layout/index';
export type { RenderOptions } from './render/index';
export { paginateInWorker } from './workers/worker-paginator';
