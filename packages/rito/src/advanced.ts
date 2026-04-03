// Rito internal APIs — parser, style resolver, layout engine, render primitives.
// Import from `rito` instead unless you need direct access to internals.

// ── Runtime (advanced) ─────────────────────────────────────────────
export { PaginationSession, type ChapterPaginationResult } from './runtime/index';

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

// ── Layout (primitives) ────────────────────────────────────────────
export {
  type LayoutBlock,
  type HorizontalRule,
  type ImageElement,
  type BlockBorders,
  type LineBox,
  type TextRun,
  type StyledSegment,
  flattenInlineContent,
  type ParagraphLayouter,
  createGreedyLayouter,
  layoutBlocks,
  paginateBlocks,
} from './layout/index';

// ── Render (primitives) ────────────────────────────────────────────
export { createCanvasTextMeasurer, buildFontString, renderPage } from './render/index';

// ── Model ──────────────────────────────────────────────────────────
export { type LayoutElement, type Rect, type Spacing } from './model/index';
