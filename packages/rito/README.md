# @ritojs/core

The Rito browser reader: a Rust EPUB engine compiled to WASM, run in a
Worker, with a Canvas presenter.

`@ritojs/core` opens EPUB archives, resolves CSS through Stylo, paginates
chapters with the engine's fragment layout and paints device-resolved
display lists on a Canvas. The same engine renders the same page in the
Flutter adapter and through the C ABI.

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

- the root entry only: `createReader()`, `preloadReaderRuntime()`,
  `createLayoutConfig()`, the `Reader` facade and its types
- `openBrowserReaderV1()` and `createBrowserReaderV1CanvasPresenter()` for
  hosts that drive the artifact protocol directly
- browser binding internals for WASM loading, the Worker, resource
  transfer, font registration, image decoding and Canvas blitting

## Documentation

- [Repository README](https://github.com/Ringyuki/Rito/blob/master/README.md)
- [Getting Started](https://github.com/Ringyuki/Rito/blob/master/docs/getting-started.md)
- [Reader API](https://github.com/Ringyuki/Rito/blob/master/docs/api/reader.md)
- [Capabilities](https://github.com/Ringyuki/Rito/blob/master/docs/capabilities.md)
- [Limitations](https://github.com/Ringyuki/Rito/blob/master/docs/limitations.md)

## Related Packages

- [`@ritojs/kit`](https://github.com/Ringyuki/Rito/tree/master/packages/kit) for transitions, overlays, and controller orchestration
- [`@ritojs/react`](https://github.com/Ringyuki/Rito/tree/master/packages/react) for React hooks and components
- [`rito_flutter`](https://pub.dev/packages/rito_flutter) for Flutter
