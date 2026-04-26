# @ritojs/kit

Framework-agnostic controller, overlays, and transitions for the Rito Web reader.

`@ritojs/kit` sits above the Web reader from `@ritojs/core/web` and provides app-facing orchestration:
page transitions, overlay composition, interaction wiring, keyboard support, and
storage adapters.

## Install

```bash
pnpm add @ritojs/core @ritojs/kit
```

## Quick Start

```ts
import { createReader } from '@ritojs/core/web';
import { createController } from '@ritojs/kit';

const container = document.getElementById('reader');
const canvas = document.createElement('canvas');

if (!container) {
  throw new Error('Expected #reader container');
}

const reader = await createReader(epubData, canvas, {
  width: 800,
  height: 600,
});

const controller = createController(reader, canvas, {
  transition: { stiffness: 180, damping: 22 },
});

controller.mount(container);
controller.goToSpread(0);
```

## Package Scope

- `createController()` for a managed reading surface
- selection, search, annotation, and reading-position orchestration
- overlay composition and animated page transitions
- keyboard manager and local-storage adapters

## Documentation

- [Kit Integration Guide](https://github.com/Ringyuki/Rito/blob/master/docs/integrations/kit.md)
- [Reader API](https://github.com/Ringyuki/Rito/blob/master/docs/api/reader.md)
- [Specialized Subpaths](https://github.com/Ringyuki/Rito/blob/master/docs/api/subpaths.md)
- [Architecture](https://github.com/Ringyuki/Rito/blob/master/docs/architecture.md)

## Related Packages

- [`@ritojs/core`](https://github.com/Ringyuki/Rito/tree/master/packages/rito) for platform-neutral parser/layout/display-list primitives and the `@ritojs/core/web` reader preset
- [`@ritojs/react`](https://github.com/Ringyuki/Rito/tree/master/packages/react) for React integration
