# `@ritojs/react`

`@ritojs/react` is the React integration layer on top of the root reader from
`@ritojs/core` and the controller layer from `@ritojs/kit`.

Use it when you want hooks for reader lifecycle and state, plus a mount component
for the controller-managed reading surface.

## Main Exports

```ts
import { useRitoReader, Reader } from '@ritojs/react';
```

Hooks:

- `useRitoReader`
- `useSelection`
- `useSearch`
- `useAnnotations`
- `useReadingPosition`
- `useContainerSize`
- `useControllerEvent`

Types:

- `UseRitoReaderOptions`
- `RitoReaderState`
- `RitoReaderActions`
- `SelectionState`
- `SearchState`
- `AnnotationsState`
- `ReadingPositionState`
- `ContainerSize`

Components:

- `Reader`
- `ReaderProps`

## Typical Use

```tsx
import { useCallback, useEffect, useRef } from 'react';
import {
  Reader,
  useContainerSize,
  useControllerEvent,
  useReaderAutoResize,
  useRitoReader,
} from '@ritojs/react';
import { springPresets } from '@ritojs/kit';
import { pinnedFontPolicy } from './pinned-fonts'; // app-owned font bytes + digests

export function App() {
  const [sizeRef, containerSize] = useContainerSize();
  const { controller, error, load } = useRitoReader({
    reader: {
      width: Math.max(containerSize.width, 1),
      height: Math.max(containerSize.height, 1),
      margin: 40,
      spread: 'double',
      // Required: the engine shapes with host font bytes only.
      pinnedFontPolicy,
      // The book opens already styled: one layout, not one per setting.
      fontSize: 18,
      fontFamily: 'serif',
    },
    controller: {
      transition: { ...springPresets.default, effect: 'slide' },
    },
  });
  // Re-paginates on every container size change after the book is loaded.
  const resizeRef = useReaderAutoResize(controller, { margin: 40 });
  const containerRef = useCallback(
    (node: HTMLElement | null) => {
      sizeRef(node);
      resizeRef(node);
    },
    [resizeRef, sizeRef],
  );

  const didLoadRef = useRef(false);
  useEffect(() => {
    if (containerSize.width === 0 || containerSize.height === 0) return;
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void load(fetch('/book.epub').then((resp) => resp.arrayBuffer()));
  }, [containerSize.width, containerSize.height, load]);

  // Non-fatal: the book stays open (a font no face answers to, a failed search…).
  useControllerEvent(controller, 'error', ({ message, source }) => {
    console.warn(source, message);
  });

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh' }}>
      {error ? <p role="alert">{error}</p> : <Reader controller={controller} />}
    </div>
  );
}
```

## `useRitoReader`

This is the highest-level React hook. It manages:

- canvas creation
- `createReader()`
- `createController()`
- state synchronization for spread count and active spread
- cleanup on unmount

Use this hook when you want a full reader lifecycle in React.

Important behavior:

- rendering the hook itself is SSR-safe
- `spreads` is the navigation record, `{ index, pageIndexes, leftPageIndex, rightPageIndex? }`,
  and `totalSpreads` its length; both are book-wide: empty and 0 until the whole book's
  layout first commits, and held at their last book-wide values while a chapter is
  committed alone after a relayout
- `load()` still needs a browser document and should run in an effect or event handler
- replacement `load()` calls wait for the previous Reader's Worker/native release before opening
  the next document
- `load()` is separate from later responsive resizes: `useReaderAutoResize(controller)` calls
  `controller.resize()` whenever the observed element changes size (or call it yourself)
- everything a book should open with — size, spread, theme, typography — belongs in
  `options.reader`, so the book lays out once, already styled; later changes go through the
  controller (`setTypography`, `setSpreadMode`, `setTheme`, `setRenderScale`)
- `error` says why the book could not be opened. The controller's own `error` events are
  non-fatal and never land there: subscribe with `useControllerEvent(controller, 'error', …)`

### Pinned fallback policy

`useRitoReader()` does not choose or fetch fallback fonts. A
`ReaderPinnedFontPolicy` is **required** by the core: finish loading the
app-owned static font bytes before calling `load()`, then pass the completed
policy under `options.reader.pinnedFontPolicy`. The hook reads the current
Reader options once the data given to `load()` has resolved; a missing or empty
policy makes the load fail.

Replacing the policy object after `load()` does not reconfigure the open Reader.
To add a face while a book is open (a system font, a file the reader imported),
use `controller.addFontFaces()`; `controller.fonts()` lists every family a
`font-family` choice can name, which is what a font picker should be built from.
See [Fonts](../api/reader.md#fonts) for how families resolve.

## `useReaderTransition`

`useReaderTransition(controller)` returns `{ isTransitioning, direction }` from the
controller's `transitionStart` / `transitionEnd`, for hiding chrome or deferring work while
a page moves. Every start is answered by exactly one end, so it never sticks, and it resets
when the controller is replaced.

`useReaderTransitionProgress(controller)` returns how far the turn on screen has moved, 0
at rest and 1 on arrival, from `transitionProgress`. It re-renders on every painted frame
of a turn, so read it in a small component of its own (a scrim, a progress edge).

## `Reader`

The `Reader` component mounts the controller's managed DOM surface into a container.

It does not own pagination logic itself, and it does not call `controller.resize()` for you.
The controller remains the source of truth.

## `useSelection`

Use `selection.hasSelection` as the selection-presence signal.
`selection.sourceLocator` carries the durable source range when both endpoints share
a resource and `selection.sourceSpan` the resource-qualified endpoints, while `text`,
`viewportRects`, `focusRect`, and `handles` are ready for copy and selection UI. The
hook clears all selection state when its controller is replaced so data cannot leak
between books.

## Guidance

- Use `@ritojs/react` if you want fast app integration and React state bindings.
- Use `@ritojs/kit` directly if you want non-React UI or a custom state layer.
- Use `@ritojs/core` if you only need the core reader without React state wiring.

## Related Docs

- [Using `@ritojs/kit`](./kit.md)
- [Reader API](../api/reader.md)
