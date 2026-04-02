// Public API surface
// All public exports flow through this file.

// Parser
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
  type InlineNode,
  NODE_TYPES,
  type NodeType,
  type TextNode,
  XhtmlParseError,
  parseXhtml,
  type ParseResult,
} from './parser/index';

// Model types
export { type LayoutElement, type Rect, type Spacing } from './model/index';

// Style
export {
  DEFAULT_STYLE,
  resolveStyles,
  type ComputedStyle,
  FONT_STYLES,
  type FontStyle,
  FONT_WEIGHTS,
  type FontWeight,
  type StyledNode,
  TEXT_ALIGNMENTS,
  type TextAlignment,
} from './style/index';

// Layout
export {
  type LayoutBlock,
  type LayoutConfig,
  type LineBox,
  type Page,
  type TextRun,
  type TextMeasurer,
  type TextMetrics,
  type StyledSegment,
  flattenInlineContent,
  type ParagraphLayouter,
  createGreedyLayouter,
  layoutBlocks,
  paginateBlocks,
} from './layout/index';

// Render
export { type RenderOptions, createCanvasTextMeasurer, renderPage } from './render/index';

// Runtime types
export { type EpubDocument, type LoadOptions } from './runtime/index';
