# Getting Started

## Scope

Rito is an EPUB-focused rendering engine, not a general-purpose browser engine.
It parses EPUB content, resolves a book-oriented CSS subset, paginates chapters,
and renders pages or spreads into Canvas.

If you want a ready-to-use rendering surface with transitions and overlays, use:

- `rito` for core rendering
- `@rito/kit` for a controller layer
- `@rito/react` for React apps

## Install

```bash
pnpm add rito
```

Optional packages:

```bash
pnpm add @rito/kit @rito/react
```

If you are working inside this repository instead of consuming the published packages:

```bash
pnpm install
pnpm run build
```

## Smallest Core Example

```ts
import { createReader } from 'rito';

const response = await fetch('/book.epub');
const canvas = document.querySelector('canvas');

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Expected a <canvas>');
}

const reader = await createReader(await response.arrayBuffer(), canvas, {
  width: 800,
  height: 600,
  margin: 40,
  spread: 'double',
});

reader.renderSpread(0);

console.log(reader.totalSpreads);
console.log(reader.toc);
```

## Common Reader Operations

```ts
reader.renderSpread(1);

reader.updateLayout(1024, 768, 'single');

reader.setTheme({
  backgroundColor: '#111827',
  foregroundColor: '#f3f4f6',
});

reader.setTypography({
  fontSize: 18,
  lineHeight: 1.6,
  fontFamily: 'Georgia, serif',
});

const firstEntry = reader.toc[0];
if (firstEntry) {
  const location = reader.resolveTocEntry(firstEntry);
  if (location) {
    reader.renderSpread(location.spreadIndex);
  }
}

reader.dispose();
```

## When To Use Which Entry

- Use `createReader()` if you want the standard browser-side flow.
- Use the stable primitives if you want your own load/paginate/render pipeline.
- Use `rito/advanced` only when you need lower-level parser, style, layout, or render internals.
- Use `@rito/kit` when you want transitions, overlays, pointer/keyboard wiring, and controller state.
- Use `@rito/react` when you want React hooks and a mount component.

## Next Steps

- [Reader API](./api/reader.md)
- [Stable Primitives](./api/primitives.md)
- [Capabilities](./capabilities.md)
- [Limitations](./limitations.md)
