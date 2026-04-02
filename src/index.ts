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
} from './parser/index';

// Model types
export { type LayoutElement, type Page, type Rect, type Spacing } from './model/index';

// Style types
export {
  DEFAULT_STYLE,
  type ComputedStyle,
  FONT_STYLES,
  type FontStyle,
  FONT_WEIGHTS,
  type FontWeight,
  TEXT_ALIGNMENTS,
  type TextAlignment,
} from './style/index';

// Layout types
export { type LayoutBlock, type LayoutConfig, type LineBox, type TextRun } from './layout/index';

// Render types
export { type RenderOptions } from './render/index';

// Runtime types
export { type EpubDocument, type LoadOptions } from './runtime/index';
