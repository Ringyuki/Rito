// Rito internal APIs — parser, style resolver, layout engine, render primitives.
// Import from `@ritojs/core` instead unless you need direct access to internals.

// ── Runtime (advanced) ─────────────────────────────────────────────
export {
  PaginationSession,
  paginateWithMeta,
  findPageForTocEntry,
  type ChapterPaginationResult,
} from './runtime/index';

// ── Parser ─────────────────────────────────────────────────────────
export {
  type ManifestItem,
  type PackageDocument,
  type PackageMetadata,
  type SpineItem,
  EpubParseError,
  type ZipReader,
  createZipReader,
  CONTAINER_PATH,
  parseContainer,
  parsePackageDocument,
  parseNavDocument,
  parseNcx,
} from './parser/index';

export {
  type BlockNode,
  type DocumentNode,
  type ElementAttributes,
  type InlineNode,
  NODE_TYPES,
  type NodeType,
  type SourceRef,
  type TextNode,
  XhtmlParseError,
  parseXhtml,
  type ParseResult,
} from './parser/index';

// ── Style ──────────────────────────────────────────────────────────
export {
  DEFAULT_STYLE,
  parseCssDeclarations,
  parseCssRules,
  resolveStyles,
  matchesSelector,
  calculateSpecificity,
  compareSpecificity,
  type ComputedStyle,
  type CssRule,
  type CssRuleOrigin,
  FONT_STYLES,
  type FontStyle,
  FONT_WEIGHTS,
  type FontWeight,
  LINE_BREAK_VALUES,
  type LineBreak,
  type Specificity,
  type StyledNode,
  TEXT_ALIGNMENTS,
  type TextAlignment,
  TEXT_DECORATIONS,
  type TextDecoration,
  TEXT_JUSTIFY_VALUES,
  type TextJustify,
  WORD_BREAK_VALUES,
  type WordBreak,
} from './style/index';

// ── Layout (primitives) ────────────────────────────────────────────
export {
  type BlockBackgroundPaint,
  type BlockBorderPaint,
  type BlockPaint,
  type BlockRadius,
  type BorderBox,
  type HorizontalRule,
  type HrPaint,
  type ImageElement,
  type LayoutBlock,
  type LineBox,
  type PagePaint,
  type RubyAnnotation,
  type RunBorder,
  type RunBorderEdge,
  type RunDecoration,
  type RunPaint,
  type StyledSegment,
  type TextRun,
  type FontMetrics,
  type FontMetricsProvider,
  type TextMeasurer,
  type TextMetrics,
  flattenInlineContent,
  type ParagraphLayouter,
  createGreedyLayouter,
  layoutBlocks,
  paginateBlocks,
} from './layout/index';
export { DEFAULT_RUN_PAINT } from './layout/text/run-paint-from-style';

// ── Render (primitives) ────────────────────────────────────────────
export {
  canvasTextMeasurementBackend,
  createTextMeasurer,
  type CachedTextMeasurer,
  buildFontString,
  renderPage,
  loadFonts,
  loadImages,
  createLazyImageLoader,
  loadFontsWithRegistry,
  loadImagesWithDecoder,
  createLazyImageLoaderWithDecoder,
  createImageAssetResolver,
  createWebFontRegistry,
  createWebImageAssetResolver,
  createWebImageDecoder,
  collectPageImageSources,
  collectSpreadImageSources,
  loadAssets,
  disposeAssets,
  canvasDisplayListRenderer,
  buildPageDisplayList,
  buildSpreadDisplayList,
  type CanvasDisplayListOptions,
  type CanvasRenderOptions,
  type CanvasRenderingTarget,
  type CanvasTextMeasurementTarget,
  type DisplayListRenderer,
  type TextMeasurementBackend,
  type FontRegistry,
  type FontResource,
  type ImageAssetResolver,
  type ImageDecoder,
  type ImageDimensions,
  type ImageObjectUrlProvider,
  type ImageResource,
  type LazyImageLoader,
  type LoadedAssets,
  type BlockDecorationPaint,
  type DisplayList,
  type DisplayListOptions,
  type DrawCommand,
} from './render/index';
export { paginateWithAssets, type Resources } from './reader/resources';

// ── Model ──────────────────────────────────────────────────────────
export { type LayoutElement, type Rect, type Spacing } from './model/index';

// ── Diagnostics ────────────────────────────────────────────────────
export { createLogger, type Logger, type LogLevel } from './utils/index';

// ── Interaction (pure computation primitives) ─────────────────────
export {
  buildHitMap,
  hitTest,
  resolveCharPosition,
  buildLinkMap,
  hitTestLink,
  getSelectionRects,
  getSelectedText,
  buildSearchIndex,
  search,
  buildSemanticTree,
  resolveAnnotationRects,
  createReadingPosition,
  resolveReadingPosition,
  type HitEntry,
  type HitMap,
  type LinkRegion,
  type TextPosition,
  type TextRange,
  type SearchIndex,
  type SearchResult,
  type SearchOptions,
  type SemanticNode,
  type SemanticRole,
  type Annotation,
  type AnnotationRenderData,
  type PositionProjection,
  type ReadingLocator,
  type ReadingPosition,
} from './interaction/index';
