# @rito/react

React hooks and components for `@rito/core` and `@rito/kit`.

`@rito/react` provides the highest-level integration layer in the Rito stack:
React hooks for reader lifecycle and state, plus a mount component for the
controller-managed reading surface.

## Install

```bash
pnpm add react react-dom @rito/core @rito/kit @rito/react
```

## Quick Start

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
- `load()` is separate from later responsive resizes; call `resize()` when container size changes after load
- sizing remains your responsibility; pair it with `useContainerSize()` or your own layout observer
