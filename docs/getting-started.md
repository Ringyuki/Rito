# Getting Started

## Scope

Rito is an EPUB-focused rendering engine, not a general-purpose browser engine.
It parses EPUB content, resolves a book-oriented CSS subset, paginates chapters,
and builds paint-ready display lists. The Web preset renders those pages or spreads into Canvas.

If you want a ready-to-use rendering surface with transitions and overlays, use:

- `@ritojs/core` for the app-facing reader and core EPUB runtime
- `@ritojs/kit` for a controller layer
- `@ritojs/react` for React apps

## Install

```bash
pnpm add @ritojs/core
```

Optional packages:

```bash
pnpm add @ritojs/kit @ritojs/react
```

If you are working inside this repository instead of consuming the published packages:

```bash
pnpm install
pnpm run build
```

## Fonts Are Required

The engine shapes text inside its WASM runtime, where no system font is
reachable: layout metrics and Canvas paint must share the exact same font
bytes, so `createReader` **requires** a `pinnedFontPolicy` with at least
one face. Ship a Latin face and a CJK face (the reference reader pins
Tinos and Source Han Serif CN) and load their bytes yourself:

```ts
import type { ReaderPinnedFontPolicy } from '@ritojs/core';

async function loadPinnedFontPolicy(): Promise<ReaderPinnedFontPolicy> {
  const [latin, cjk] = await Promise.all([
    fetch('/fonts/Tinos-Regular.ttf').then((r) => r.arrayBuffer()),
    fetch('/fonts/SourceHanSerifCN-Regular.otf').then((r) => r.arrayBuffer()),
  ]);
  return {
    schemaVersion: 1,
    faces: [
      { bytes: latin, expectedSha256: '', genericRole: 'serif', language: 'und' },
      { bytes: cjk, expectedSha256: '', genericRole: 'serif', language: 'zh-Hans' },
    ],
  };
}
```

A missing or empty policy makes `createReader` throw immediately — the
engine cannot start without shapeable font bytes.

## Smallest Web Canvas Example

```ts
import { createReader } from '@ritojs/core';

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
  pinnedFontPolicy: await loadPinnedFontPolicy(),
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

- Use `createReader()` from `@ritojs/core` if you want the standard reader flow.
- Use the source-only TypeScript reference implementation inside this repository
  only for diagnostics, parity work, or custom migration tools.
- Use `@ritojs/kit` when you want transitions, overlays, pointer/keyboard wiring, and controller state.
- Use `@ritojs/react` when you want React hooks and a mount component.

For Flutter, Skia, native, server-side, or other non-Web runtimes, the target
is the Rust runtime contract behind `@ritojs/core`, not the historical
TypeScript Canvas reference.

## Next Steps

- [Reader API](./api/reader.md)
- [Reference Primitives](./api/primitives.md)
- [Capabilities](./capabilities.md)
- [Limitations](./limitations.md)
