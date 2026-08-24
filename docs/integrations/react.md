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
import { useEffect, useRef } from 'react';
import { Reader, useContainerSize, useRitoReader } from '@ritojs/react';

export function App() {
  const [containerRef, containerSize] = useContainerSize();
  const width = Math.max(containerSize.width, 1);
  const height = Math.max(containerSize.height, 1);
  const didLoadRef = useRef(false);
  const { controller, isLoaded, load, resize } = useRitoReader({
    reader: {
      width,
      height,
      margin: 40,
      spread: 'double',
    },
    controller: {
      transition: { stiffness: 180, damping: 22 },
    },
  });

  useEffect(() => {
    if (containerSize.width === 0 || containerSize.height === 0) return;
    if (didLoadRef.current) return;
    didLoadRef.current = true;
    void load(fetch('/book.epub').then((resp) => resp.arrayBuffer()));
  }, [containerSize.width, containerSize.height, load]);

  useEffect(() => {
    if (!isLoaded) return;
    resize(width, height);
  }, [height, isLoaded, resize, width]);

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh' }}>
      <Reader controller={controller} />
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
- `load()` still needs a browser document and should run in an effect or event handler
- replacement `load()` calls wait for the previous Reader's Worker/native release before opening
  the next document
- `load()` is separate from later responsive resizes; call `resize()` when container size changes after load
- sizing remains your responsibility; pair it with `useContainerSize()` or your own layout observer

### Pinned fallback policy

`useRitoReader()` does not choose or fetch fallback fonts. A
`ReaderPinnedFontPolicy` is **required** by the core: finish loading the
app-owned static font bytes before calling `load()`, then pass the completed
policy under `options.reader.pinnedFontPolicy`. The hook samples the current
Reader options when a load starts; a missing or empty policy makes the load
fail immediately.

A pinned policy is immutable for one loaded Reader. Replacing the policy object
after `load()` does not reconfigure that Reader or its registered `FontFace`s.
Call `load()` again to dispose the current stack and create the next Reader with
the new policy. See the [Reader API](../api/reader.md#readeroptions) for the
static-asset example and for the exact-geometry behavior when no policy is set.

## `Reader`

The `Reader` component mounts the controller's managed DOM surface into a container.

It does not own pagination logic itself, and it does not call `controller.resize()` for you.
The controller remains the source of truth.

## `useSelection`

Use `selection.hasSelection` as the selection-presence signal. For Readers with
native exact text interaction, `selection.range` is intentionally `null` because
opaque Rust carets cannot be represented as the legacy layout-local `TextRange`.
`selection.sourceLocator` carries the durable source range, while `text`,
`viewportRects`, and `focusRect` remain ready for copy and selection UI. The hook
clears all selection state when its controller is replaced so data cannot leak
between books.

## Guidance

- Use `@ritojs/react` if you want fast app integration and React state bindings.
- Use `@ritojs/kit` directly if you want non-React UI or a custom state layer.
- Use `@ritojs/core` if you only need the core reader without React state wiring.
- Use source-level diagnostics inside this repository when you intentionally
  need the old TypeScript reference implementation.

## Related Docs

- [Using `@ritojs/kit`](./kit.md)
- [Reader API](../api/reader.md)
