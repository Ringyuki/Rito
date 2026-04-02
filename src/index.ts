// Public API surface
// All public exports flow through this file.

// ── Primary API ─────────────────────────────────────────────────────
export { loadEpub } from './runtime/index';
export { paginate } from './runtime/index';
export { renderPage } from './render/index';
export { createTextMeasurer } from './render/index';

// ── Types ───────────────────────────────────────────────────────────
export { type EpubDocument, type LoadOptions } from './runtime/index';
export { type LayoutConfig, type Page } from './layout/index';
export { type TextMeasurer, type TextMetrics } from './layout/index';
export { type RenderOptions } from './render/index';

// ── Parser ──────────────────────────────────────────────────────────
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
} from './layout/index';

// ── Render ──────────────────────────────────────────────────────────
export { createCanvasTextMeasurer, buildFontString } from './render/index';

// ── Model ───────────────────────────────────────────────────────────
export { type LayoutElement, type Rect, type Spacing } from './model/index';
