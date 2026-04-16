# @rito/core

TypeScript-first Canvas-based EPUB rendering engine.

`@rito/core` is the core package in the Rito monorepo. It parses EPUB archives, resolves a
book-oriented CSS subset, paginates chapters, and renders pages or spreads into Canvas.

## Install

```bash
pnpm add @rito/core
```

## Quick Start

```ts
import { createReader } from '@rito/core';

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
```

## Package Scope

- `createReader()` for the standard browser-side flow
- stable primitives such as `loadEpub`, `prepare`, `paginate`, `buildSpreads`, and `render`
- expert entry points such as `@rito/core/advanced`
- focused subpaths such as `@rito/core/selection`, `@rito/core/search`, `@rito/core/annotations`, `@rito/core/position`, `@rito/core/a11y`, and `@rito/core/dom`

## Documentation

- [Repository README](https://github.com/Ringyuki/Rito/blob/master/README.md)
- [Getting Started](https://github.com/Ringyuki/Rito/blob/master/docs/getting-started.md)
- [Reader API](https://github.com/Ringyuki/Rito/blob/master/docs/api/reader.md)
- [Stable Primitives](https://github.com/Ringyuki/Rito/blob/master/docs/api/primitives.md)
- [Advanced Entry](https://github.com/Ringyuki/Rito/blob/master/docs/api/advanced.md)
- [Capabilities](https://github.com/Ringyuki/Rito/blob/master/docs/capabilities.md)
- [Limitations](https://github.com/Ringyuki/Rito/blob/master/docs/limitations.md)

## Related Packages

- [`@rito/kit`](https://github.com/Ringyuki/Rito/tree/master/packages/kit) for transitions, overlays, and controller orchestration
- [`@rito/react`](https://github.com/Ringyuki/Rito/tree/master/packages/react) for React hooks and components
