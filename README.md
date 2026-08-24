# Rito

A Rust-backed EPUB reader core with TypeScript package bindings.

Rito is an EPUB-focused reader engine. It opens EPUB archives, resolves a
book-oriented CSS subset, creates layout revisions, builds paint-ready frames,
and renders pages or spreads through the browser package facade.

The repository also includes:

- `@ritojs/core` — the Rust-backed core reader package
- `@ritojs/kit` — a framework-agnostic controller layer with transitions and overlays
- `@ritojs/react` — React hooks and components on top of the core packages

## Install

```bash
pnpm add @ritojs/core
```

## Quick Start

```ts
import { createReader } from '@ritojs/core';

const response = await fetch('book.epub');
const canvas = document.querySelector('canvas')!;

// The engine shapes text with pinned font bytes (no system font is
// reachable inside the WASM runtime) — a pinnedFontPolicy is required.
// See docs/getting-started.md for a complete loader.
const reader = await createReader(await response.arrayBuffer(), canvas, {
  width: 800,
  height: 600,
  margin: 40,
  spread: 'double',
  pinnedFontPolicy: await loadPinnedFontPolicy(),
});

reader.renderSpread(0);
console.log(`${reader.totalSpreads} spreads, ${reader.toc.length} TOC entries`);

reader.dispose();
```

## Documentation

- [Documentation Index](./docs/README.md)
- [Getting Started](./docs/getting-started.md)
- [Reader API](./docs/api/reader.md)
- [Reference Primitives](./docs/api/primitives.md)
- [Advanced Entry](./docs/api/advanced.md)
- [Specialized Subpaths](./docs/api/subpaths.md)
- [Capabilities](./docs/capabilities.md)
- [Limitations](./docs/limitations.md)
- [Using `@ritojs/kit`](./docs/integrations/kit.md)
- [Using `@ritojs/react`](./docs/integrations/react.md)
- [Development Docs](./docs/development/README.md)

## Release Scope

Rito is optimized for EPUB book layout, not browser-equivalent web layout.

- EPUB-first rendering model
- small, stable reader API on the main `@ritojs/core` entry
- source-only TypeScript reference implementation for golden and parity work
- optional higher-level integration packages for controllers and React
- deliberate CSS/layout subset focused on book pagination

See the detailed scope in [Capabilities](./docs/capabilities.md) and [Limitations](./docs/limitations.md).

## Development

```bash
pnpm install
pnpm run check
```
