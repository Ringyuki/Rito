# @ritojs/core

Rust-backed EPUB reader core with a browser package facade.

`@ritojs/core` is the core package in the Rito monorepo. It opens EPUB archives,
creates layout revisions, builds paint-ready reader frames, and exposes the
browser reader through the root package entry. The legacy TypeScript core is
kept in source for diagnostics, golden comparison, and Rust parity work; it is
not a public package surface.

## Install

```bash
pnpm add @ritojs/core
```

## Quick Start

```ts
import { createReader } from '@ritojs/core';

const response = await fetch('/book.epub');
const canvas = document.querySelector('canvas');

if (!(canvas instanceof HTMLCanvasElement)) {
  throw new Error('Expected a <canvas>');
}

// pinnedFontPolicy is REQUIRED: the WASM engine shapes text with these
// exact font bytes (layout and paint share them). See the repository's
// getting-started guide for a complete loader.
const reader = await createReader(await response.arrayBuffer(), canvas, {
  width: 800,
  height: 600,
  margin: 40,
  spread: 'double',
  pinnedFontPolicy: await loadPinnedFontPolicy(),
});

reader.renderSpread(0);
```

## Package Scope

- root `@ritojs/core` reader entry: `createReader()`, `preloadReaderRuntime()`, `Reader`, and `ReaderOptions`
- browser binding internals for WASM loading, worker setup, resource transfer, and Canvas presentation
- no legacy TypeScript subpath exports; source-only reference code lives under `src/reference/**`

## Documentation

- [Repository README](https://github.com/Ringyuki/Rito/blob/master/README.md)
- [Getting Started](https://github.com/Ringyuki/Rito/blob/master/docs/getting-started.md)
- [Reader API](https://github.com/Ringyuki/Rito/blob/master/docs/api/reader.md)
- [Reference Primitives](https://github.com/Ringyuki/Rito/blob/master/docs/api/primitives.md)
- [Capabilities](https://github.com/Ringyuki/Rito/blob/master/docs/capabilities.md)
- [Limitations](https://github.com/Ringyuki/Rito/blob/master/docs/limitations.md)

## Related Packages

- [`@ritojs/kit`](https://github.com/Ringyuki/Rito/tree/master/packages/kit) for transitions, overlays, and controller orchestration
- [`@ritojs/react`](https://github.com/Ringyuki/Rito/tree/master/packages/react) for React hooks and components
