# Advanced Entry

```ts
import {
  parseXhtml,
  resolveStyles,
  layoutBlocks,
  buildSpreadDisplayList,
} from '@ritojs/core/advanced';
```

`@ritojs/core/advanced` exposes expert-facing parser, style, layout, render, model, diagnostics,
and pure interaction primitives.

Use this entry only when the main `@ritojs/core` API is too high-level for your needs.

## Stability Guidance

- Prefer `@ritojs/core` for platform-neutral pipelines.
- Prefer `@ritojs/core/web` for browser Canvas app-facing code.
- Prefer `@ritojs/core/advanced` only for custom pipelines, low-level tooling, or engine work.
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
- `TextMeasurer`
- `TextMetrics`
- `FontMetricsProvider`
- `FontMetrics`

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
- you are adapting Rito pagination to a non-Web font engine

## Render

- `buildPageDisplayList`
- `buildSpreadDisplayList`
- `renderPage`
- `canvasDisplayListRenderer`
- `canvasTextMeasurementBackend`
- `createTextMeasurer`
- `buildFontString`
- `loadFonts`
- `loadImages`
- `loadFontsWithRegistry`
- `loadImagesWithDecoder`
- `createLazyImageLoader`
- `createLazyImageLoaderWithDecoder`
- `createImageAssetResolver`
- `createWebFontRegistry`
- `createWebImageAssetResolver`
- `createWebImageDecoder`
- `collectPageImageSources`
- `collectSpreadImageSources`
- `loadAssets`
- `paginateWithAssets`
- `disposeAssets`

Types:

- `DisplayList`
- `DisplayListOptions`
- `DrawCommand`
- `DisplayListRenderer`
- `TextMeasurementBackend`
- `CanvasDisplayListOptions`
- `CanvasRenderingTarget`
- `CanvasTextMeasurementTarget`
- `BlockDecorationPaint`
- `CachedTextMeasurer`
- `LazyImageLoader`
- `LoadedAssets`
- `Resources`
- `FontRegistry`
- `FontResource`
- `ImageAssetResolver`
- `ImageDecoder`
- `ImageDimensions`
- `ImageObjectUrlProvider`
- `ImageResource`

Use these when:

- you want resource preparation without the full `Reader`
- you need direct display-list construction or Web Canvas page rendering instead of the full `Reader`
- you want lower-level control over browser-side asset lifecycle
- you are experimenting with a non-Canvas backend from Rito display lists
- you need to preload images for a custom lazy image resolver
- you need the default Web text measurement adapter, including font metrics

`@ritojs/core/advanced` intentionally exposes both platform-neutral internals
and concrete Web Canvas adapters. Keep public app code on `@ritojs/core` or
`@ritojs/core/web` unless you need this lower-level surface.

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
