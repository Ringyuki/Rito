# Advanced Entry

```ts
import { parseXhtml, resolveStyles, layoutBlocks, renderPage } from '@rito/core/advanced';
```

`@rito/core/advanced` exposes expert-facing parser, style, layout, render, model, diagnostics,
and pure interaction primitives.

Use this entry only when the main `@rito/core` API is too high-level for your needs.

## Stability Guidance

- Prefer the main `@rito/core` entry for app-facing code.
- Prefer `@rito/core/advanced` only for custom pipelines, low-level tooling, or engine work.
- Types and helpers here are intentionally lower-level and require more architectural discipline.

## Parser

### EPUB structure

- `createZipReader`
- `CONTAINER_PATH`
- `parseContainer`
- `parsePackageDocument`
- `parseNavDocument`
- `parseNcx`
- `EpubParseError`

Types:

- `ManifestItem`
- `PackageDocument`
- `PackageMetadata`
- `SpineItem`
- `ZipReader`

### XHTML content

- `parseXhtml`
- `XhtmlParseError`
- `NODE_TYPES`

Types:

- `BlockNode`
- `DocumentNode`
- `ElementAttributes`
- `InlineNode`
- `NodeType`
- `ParseResult`
- `SourceRef`
- `TextNode`

Use these when:

- you want to inspect EPUB structure without paginating
- you are building tooling around raw parsed chapter content
- you want to run a custom style/layout pipeline

## Style

- `resolveStyles`
- `parseCssRules`
- `parseCssDeclarations`
- `matchesSelector`
- `calculateSpecificity`
- `compareSpecificity`
- `DEFAULT_STYLE`

Types and constants:

- `ComputedStyle`
- `CssRule`
- `StyledNode`
- `Specificity`
- `FontStyle`, `FONT_STYLES`
- `FontWeight`, `FONT_WEIGHTS`
- `TextAlignment`, `TEXT_ALIGNMENTS`
- `TextDecoration`, `TEXT_DECORATIONS`

Use these when:

- you need direct access to resolved styles
- you are testing or debugging CSS behavior
- you are building custom style tooling around Rito's EPUB-focused CSS subset

## Layout

- `layoutBlocks`
- `paginateBlocks`
- `flattenInlineContent`
- `createGreedyLayouter`
- `DEFAULT_RUN_PAINT`

Core paint-ready types:

- `LayoutBlock`
- `TextRun`
- `LineBox`
- `ImageElement`
- `HorizontalRule`
- `PagePaint`
- `BlockPaint`
- `RunPaint`
- `HrPaint`
- `RubyAnnotation`
- `StyledSegment`
- `ParagraphLayouter`

Supporting geometry types:

- `BorderBox`
- `BlockBackgroundPaint`
- `BlockBorderPaint`
- `BlockRadius`
- `RunBorder`
- `RunBorderEdge`
- `RunDecoration`

Use these when:

- you want your own pagination orchestration
- you need to inspect layout output directly
- you want to render pages with your own outer pipeline

## Render

- `renderPage`
- `createCanvasTextMeasurer`
- `createTextMeasurer`
- `buildFontString`
- `loadFonts`
- `loadImages`
- `createLazyImageLoader`
- `loadAssets`
- `paginateWithAssets`
- `disposeAssets`

Types:

- `CachedTextMeasurer`
- `LazyImageLoader`
- `LoadedAssets`
- `Resources`

Use these when:

- you want resource preparation without the full `Reader`
- you need direct page rendering instead of spread rendering
- you want lower-level control over browser-side asset lifecycle

## Runtime

- `PaginationSession`
- `paginateWithMeta`
- `findPageForTocEntry`

Types:

- `ChapterPaginationResult`

Use these when:

- you want metadata-rich pagination results
- you need incremental or session-oriented pagination control
- you want navigation resolution without the full `Reader`

## Model

Types:

- `LayoutElement`
- `Rect`
- `Spacing`

## Diagnostics

- `createLogger`

Types:

- `Logger`
- `LogLevel`

## Pure Interaction Primitives

- `buildHitMap`
- `hitTest`
- `resolveCharPosition`
- `buildLinkMap`
- `hitTestLink`
- `getSelectionRects`
- `getSelectedText`
- `buildSearchIndex`
- `search`
- `buildSemanticTree`
- `resolveAnnotationRects`
- `createReadingPosition`
- `resolveReadingPosition`

Types:

- `HitEntry`
- `HitMap`
- `LinkRegion`
- `TextPosition`
- `TextRange`
- `SearchIndex`
- `SearchResult`
- `SearchOptions`
- `SemanticNode`
- `SemanticRole`
- `Annotation`
- `AnnotationRenderData`
- `ReadingPosition`

## Related Docs

- [Reader API](./reader.md)
- [Stable Primitives](./primitives.md)
- [Specialized Subpaths](./subpaths.md)
- [Architecture](../architecture.md)
