# Rito

A TypeScript-first EPUB rendering library with a platform-neutral core and a Web Canvas preset.

Rito is an EPUB-focused rendering engine. It parses EPUB archives, resolves a book-oriented CSS subset, paginates chapters, builds display lists, and renders pages or spreads into Canvas through the Web preset.

The repository also includes:

- `@ritojs/core` — platform-neutral parser/layout/pagination/display-list primitives
- `@ritojs/core/web` — the default browser Canvas preset within the core package
- `@ritojs/kit` — a framework-agnostic controller layer with transitions and overlays
- `@ritojs/react` — React hooks and components on top of the core packages

> [!WARNING]
> Rito is still under development! We do not recommend that you use it in production environments, but of course we always welcome your PR!

## Install

```bash
pnpm add @ritojs/core
```

## Quick Start

```ts
import { createReader } from '@ritojs/core/web';

const response = await fetch('book.epub');
const canvas = document.querySelector('canvas')!;

const reader = await createReader(await response.arrayBuffer(), canvas, {
  width: 800,
  height: 600,
  margin: 40,
  spread: 'double',
});

reader.renderSpread(0);
console.log(`${reader.totalSpreads} spreads, ${reader.toc.length} TOC entries`);

reader.dispose();
```

## Documentation

- [Documentation Index](./docs/README.md)
- [Getting Started](./docs/getting-started.md)
- [Reader API](./docs/api/reader.md)
- [Stable Primitives](./docs/api/primitives.md)
- [Advanced Entry](./docs/api/advanced.md)
- [Specialized Subpaths](./docs/api/subpaths.md)
- [Capabilities](./docs/capabilities.md)
- [Limitations](./docs/limitations.md)
- [Architecture](./docs/architecture.md)
- [Release & Versioning](./docs/releasing.md)
- [Using `@ritojs/kit`](./docs/integrations/kit.md)
- [Using `@ritojs/react`](./docs/integrations/react.md)

## Release Scope

Rito is optimized for EPUB book layout, not browser-equivalent web layout.

- EPUB-first rendering model
- small, stable public API on the main `@ritojs/core` entry
- Web-only reader helpers isolated under `@ritojs/core/web`
- optional higher-level integration packages for controllers and React
- deliberate CSS/layout subset focused on book pagination

See the detailed scope in [Capabilities](./docs/capabilities.md) and [Limitations](./docs/limitations.md).

## Development

```bash
pnpm install
pnpm run check
```
