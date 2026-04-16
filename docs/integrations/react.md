# `@rito/react`

`@rito/react` is the React integration layer on top of `@rito/core` and `@rito/kit`.

Use it when you want hooks for reader lifecycle and state, plus a mount component
for the controller-managed reading surface.

## Main Exports

```ts
import { useRitoReader, Reader } from '@rito/react';
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
import { Reader, useContainerSize, useRitoReader } from '@rito/react';

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
- `load()` is separate from later responsive resizes; call `resize()` when container size changes after load
- sizing remains your responsibility; pair it with `useContainerSize()` or your own layout observer

## `Reader`

The `Reader` component mounts the controller's managed DOM surface into a container.

It does not own pagination logic itself, and it does not call `controller.resize()` for you.
The controller remains the source of truth.

## Guidance

- Use `@rito/react` if you want fast app integration and React state bindings.
- Use `@rito/kit` directly if you want non-React UI or a custom state layer.
- Use only `@rito/core` if you only need rendering and core primitives.

## Related Docs

- [Using `@rito/kit`](./kit.md)
- [Reader API](../api/reader.md)
