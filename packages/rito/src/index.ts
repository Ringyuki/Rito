// Public API surface
// All public exports flow through this file.

// ── Primary API ─────────────────────────────────────────────────────
export { loadEpub } from './runtime/index';
export { prepare, disposeResources, type Resources } from './render/index';
export { render } from './render/index';

// ── Advanced / lower-level ──────────────────────────────────────────
export { paginate, paginateWithMeta } from './runtime/index';
export { PaginationSession, type ChapterPaginationResult } from './runtime/index';
export { findPageForTocEntry } from './runtime/index';
export { createTextMeasurer } from './render/index';
export { loadFonts } from './render/index';
export { loadImages } from './render/index';

// ── Types ───────────────────────────────────────────────────────────
export {
  type EpubDocument,
  type LoadOptions,
  type ChapterRange,
  type PaginationResult,
} from './runtime/index';
export { type LayoutConfig, type LayoutConfigInput, type Page } from './layout/index';
export { createLayoutConfig } from './layout/index';
export { type TextMeasurer, type TextMetrics } from './layout/index';
export { type RenderOptions } from './render/index';

// ── Parser ──────────────────────────────────────────────────────────
export {
  type ManifestItem,
  type PackageDocument,
  type PackageMetadata,
  type SpineItem,
  type TocEntry,
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
  type TextNode,
  XhtmlParseError,
  parseXhtml,
  type ParseResult,
} from './parser/index';

// ── Style ───────────────────────────────────────────────────────────
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
  FONT_STYLES,
  type FontStyle,
  FONT_WEIGHTS,
  type FontWeight,
  type Specificity,
  type StyledNode,
  TEXT_ALIGNMENTS,
  type TextAlignment,
  TEXT_DECORATIONS,
  type TextDecoration,
} from './style/index';

// ── Layout ──────────────────────────────────────────────────────────
export {
  type LayoutBlock,
  type LineBox,
  type TextRun,
  type StyledSegment,
  flattenInlineContent,
  type ParagraphLayouter,
  createGreedyLayouter,
  layoutBlocks,
  paginateBlocks,
  type Spread,
  buildSpreads,
} from './layout/index';

// ── Render ──────────────────────────────────────────────────────────
export {
  createCanvasTextMeasurer,
  buildFontString,
  renderPage,
  getSpreadDimensions,
} from './render/index';

// ── Model ───────────────────────────────────────────────────────────
export { type LayoutElement, type Rect, type Spacing } from './model/index';
