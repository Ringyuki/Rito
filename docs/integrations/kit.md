# `@rito/kit`

`@rito/kit` is the framework-agnostic orchestration layer built on top of `rito`.

Use it when the core `Reader` is too low-level and you want a production-oriented reading surface:

- page transitions
- overlay composition
- search / selection / annotations wiring
- keyboard integration
- position storage hooks

## Main Exports

```ts
import { createController } from '@rito/kit';
```

Core exports:

- `createController`
- `ReaderController`
- `ReaderControllerEvents`
- `ControllerOptions`
- `InteractionMode`
- `AddAnnotationInput`

Supporting exports:

- `createKeyboardManager`
- `KeyboardManager`
- `createLocalStorageAnnotationAdapter`
- `createLocalStoragePositionAdapter`
- `PositionStorageAdapter`
- `OverlayLayer`
- `Rect`
- `TransitionDriverOptions`
- `createEmitter`
- `TypedEmitter`
- `createDisposableCollection`
- `DisposableCollection`

## Typical Use

```ts
import { createReader } from 'rito';
import { createController } from '@rito/kit';

const container = document.getElementById('reader');
const canvas = document.createElement('canvas');

if (!container) throw new Error('Expected #reader container');

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

The controller owns the mounted reading surface after `mount()`: transition layers,
overlay canvas, and interaction bindings are attached under that container.

## Responsibilities

`@rito/kit` adds the app-facing interaction layer on top of core rendering:

- display-surface management
- buffer pool and overlay composition
- transition driver and frame scheduling
- selection/search/annotation/position engines
- pointer/touch/keyboard wiring
- optional storage-backed position and annotations

## When Not To Use It

Skip `@rito/kit` when:

- you only need page rendering into a canvas
- you already have a controller/orchestration layer
- you want a very custom interaction model and only need core primitives

## Related Docs

- [Reader API](../api/reader.md)
- [Specialized Subpaths](../api/subpaths.md)
- [Using `@rito/react`](./react.md)
