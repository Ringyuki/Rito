# Specialized Subpaths

Rito exposes focused subpath entries for higher-level interaction and integration helpers.

## `@ritojs/core/selection`

```ts
import { createSelectionEngine } from '@ritojs/core/selection';
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

- you want stateful text selection behavior without `@ritojs/kit`
- you are wiring your own pointer model around page content

## `@ritojs/core/search`

```ts
import { createSearchEngine } from '@ritojs/core/search';
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

## `@ritojs/core/annotations`

```ts
import { createAnnotationStore, resolveAnnotations } from '@ritojs/core/annotations';
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

## `@ritojs/core/position`

```ts
import { createPositionTracker } from '@ritojs/core/position';
```

Exports:

- `createPositionTracker`
- `PositionTracker`
- `ReadingPosition`

Use when:

- you need resumable reading position tracking
- you want a focused reading-progress module

## `@ritojs/core/a11y`

```ts
import { createA11yMirror, buildSemanticTree } from '@ritojs/core/a11y';
```

Exports:

- `createA11yMirror`
- `A11yMirror`
- `buildSemanticTree`
- `SemanticNode`
- `SemanticRole`

Use when:

- you need an accessibility mirror or semantic structure derived from paginated content

## `@ritojs/core/dom`

```ts
import { bindPointerEvents, bindClipboard, bindLinkCursor } from '@ritojs/core/dom';
```

Exports:

- `bindPointerEvents`
- `bindClipboard`
- `bindLinkCursor`

Use when:

- you want optional DOM bindings without committing to `@ritojs/kit`
- you already have your own UI/controller layer

## Guidance

- Use these subpaths when you want focused functionality without importing `@ritojs/core/advanced`.
- If you want the full reading-surface controller layer, prefer [`@ritojs/kit`](../integrations/kit.md).
- If you want React integration, prefer [`@ritojs/react`](../integrations/react.md).
