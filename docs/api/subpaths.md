# Specialized Subpaths

Rito exposes focused subpath entries for higher-level interaction and integration helpers.

## `@rito/core/selection`

```ts
import { createSelectionEngine } from '@rito/core/selection';
```

Exports:

- `createSelectionEngine`
- `SelectionEngine`
- `SelectionState`
- `SelectionSnapshot`
- `PagedPosition`
- `PointerInput`
- `TextPosition`
- `TextRange`

Use when:

- you want stateful text selection behavior without `@rito/kit`
- you are wiring your own pointer model around page content

## `@rito/core/search`

```ts
import { createSearchEngine } from '@rito/core/search';
```

Exports:

- `createSearchEngine`
- `SearchEngine`
- `SearchIndex`
- `SearchResult`
- `SearchOptions`

Use when:

- you want full-text search as a focused module
- you are building your own search UI and navigation

## `@rito/core/annotations`

```ts
import { createAnnotationStore, resolveAnnotations } from '@rito/core/annotations';
```

Exports:

- annotation store:
  - `createAnnotationStore`
  - `AnnotationStore`
  - `RecordStorageAdapter`
- record model:
  - `AnnotationRecord`
  - `AnnotationDraft`
  - `AnnotationRecordPatch`
- resolution:
  - `resolveAnnotations`
  - `resolveSourceRangeToSegments`
  - `ResolvedAnnotation`
  - `ResolvedAnnotationSegment`
  - `ResolutionContext`
  - `ResolutionStatus`
- anchor helpers:
  - `createAnnotationTarget`
  - `CreateTargetFromOffsetsInput`
  - `sourcePointToOffset`
  - `offsetToSourcePoint`
  - `buildChapterTextIndex`
  - `ChapterTextIndex`
  - `ChapterTextSpan`
  - `AnnotationTarget`
  - `AnnotationSelectors`
  - `SourcePoint`
  - `SourceRangeSelector`

Use when:

- you want source-anchored highlights, underlines, or notes
- you need annotation data to survive repagination and viewport changes

## `@rito/core/position`

```ts
import { createPositionTracker } from '@rito/core/position';
```

Exports:

- `createPositionTracker`
- `PositionTracker`
- `ReadingPosition`

Use when:

- you need resumable reading position tracking
- you want a focused reading-progress module

## `@rito/core/a11y`

```ts
import { createA11yMirror, buildSemanticTree } from '@rito/core/a11y';
```

Exports:

- `createA11yMirror`
- `A11yMirror`
- `buildSemanticTree`
- `SemanticNode`
- `SemanticRole`

Use when:

- you need an accessibility mirror or semantic structure derived from paginated content

## `@rito/core/dom`

```ts
import { bindPointerEvents, bindClipboard, bindLinkCursor } from '@rito/core/dom';
```

Exports:

- `bindPointerEvents`
- `bindClipboard`
- `bindLinkCursor`

Use when:

- you want optional DOM bindings without committing to `@rito/kit`
- you already have your own UI/controller layer

## Guidance

- Use these subpaths when you want focused functionality without importing `@rito/core/advanced`.
- If you want the full reading-surface controller layer, prefer [`@rito/kit`](../integrations/kit.md).
- If you want React integration, prefer [`@rito/react`](../integrations/react.md).
