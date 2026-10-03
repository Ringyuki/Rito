# @ritojs/react

React hooks and components for the `@ritojs/core` reader and `@ritojs/kit`.

`@ritojs/react` provides the highest-level integration layer in the Rito stack:
React hooks for reader lifecycle and state, plus a mount component for the
controller-managed reading surface.

## Install

```bash
pnpm add react react-dom @ritojs/core @ritojs/kit @ritojs/react
```

## Quick Start

```tsx
import { useCallback, useEffect, useRef } from 'react';
import { Reader, useContainerSize, useReaderAutoResize, useRitoReader } from '@ritojs/react';
import { pinnedFontPolicy } from './pinned-fonts'; // app-owned font bytes + digests

export function App() {
  const [sizeRef, containerSize] = useContainerSize();
  const { controller, error, load } = useRitoReader({
    reader: {
      width: Math.max(containerSize.width, 1),
      height: Math.max(containerSize.height, 1),
      margin: 40,
      spread: 'double',
      pinnedFontPolicy,
    },
  });
  // Re-paginates whenever the container changes size.
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

  return (
    <div ref={containerRef} style={{ width: '100vw', height: '100vh' }}>
      {error ? <p role="alert">{error}</p> : <Reader controller={controller} />}
    </div>
  );
}
```

## Package Scope

- `useRitoReader()` for full reader + controller lifecycle
- hooks for selection, search, annotations, reading position, and container sizing
- `Reader` mount component for the controller-managed surface

## Documentation

- [React Integration Guide](https://github.com/Ringyuki/Rito/blob/master/docs/integrations/react.md)
- [Kit Integration Guide](https://github.com/Ringyuki/Rito/blob/master/docs/integrations/kit.md)
- [Reader API](https://github.com/Ringyuki/Rito/blob/master/docs/api/reader.md)
- [Capabilities](https://github.com/Ringyuki/Rito/blob/master/docs/capabilities.md)

## Notes

- rendering the hook itself is SSR-safe
- `load()` still requires a browser document and should run in an effect or event handler
- `load()` takes an EPUB `ArrayBuffer` or a sharded publication (`{ skeleton, key?, loadShards }`, see the sharded publications guide); either may be a promise
- `useReaderAutoResize(controller)` re-paginates when the observed element changes size
- pass everything a book should open with (size, spread, theme, typography) in `options.reader`
  so it lays out once; later changes go through the controller
- `error` says why the book could not be opened; the controller's own `error` events are
  non-fatal — subscribe with `useControllerEvent(controller, 'error', …)`
- load the app-owned `ReaderPinnedFontPolicy` bytes before calling `load()`; add a face while a
  book is open with `controller.addFontFaces()`, and build font choices from `controller.fonts()`
- use `useSelection().hasSelection` for presence; `sourceLocator` carries the durable
  source range and `viewportRects`/`handles` the geometry for selection UI
- `useRitoReader().spreads` is the reader's navigation record (page indexes per spread)
