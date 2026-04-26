# Architecture

Rito is organized around explicit boundaries:

1. parse EPUB/XHTML
2. resolve styles
3. compute layout and pagination
4. build platform-neutral display lists from paint-ready pages
5. execute those display lists through a rendering backend
6. optionally layer interaction/controller logic on top

## Package Layering

```text
packages/rito/
  src/index.ts      Platform-neutral public API
  src/web.ts        Web Canvas preset API
  src/advanced.ts   Expert-facing lower-level API
  src/reader/       Web Canvas Reader facade
  src/parser/       EPUB structure + XHTML parsing
  src/style/        CSS subset parsing + cascade resolution
  src/layout/       Pure layout + pagination + spread building
  src/render/       Display-list model, backend contracts, Web Canvas backend, resource adapters
  src/runtime/      Higher-level orchestration
  src/interaction/  Selection, search, annotations, position, semantics
  src/dom/          Optional DOM bindings
  src/utils/        Shared helpers

packages/kit/
  src/controller/   Orchestration layer for reading interactions
  src/painter/      Display surface + buffers + overlays
  src/driver/       Animation and frame scheduling
  src/keyboard/     Keyboard manager
  src/storage/      Storage adapters

packages/react/
  src/hooks/        React state and lifecycle hooks
  src/components/   Reader mount component

apps/reader/
  Demonstration app for the full stack
```

## Core Boundary: Layout vs Render

The most important invariant is that layout and render communicate through paint-ready types.

In practice:

- layout produces geometry and paint aggregates
- render consumes those paint aggregates
- render does not consume raw `ComputedStyle`
- render does not parse CSS strings

This keeps pagination and rendering decoupled and testable.

## Display List / Backend Boundary

Rendering is split into two steps:

1. `Page` + paint aggregates are converted into a platform-neutral `DisplayList`.
2. A backend executes that display list. The default Web preset targets Web Canvas.

The display-list contract is intentionally not a thin wrapper over `CanvasRenderingContext2D`.
It carries Rito's own drawing commands, logical coordinates, structured paint data, and image
references. This keeps Web Canvas as one backend instead of making it the architecture itself.
Backends consume display-list commands directly; they should not reconstruct `LayoutBlock`,
`TextRun`, or other layout node shapes to render.
The backend contract is the structural `DisplayListRenderer<TTarget, TOptions>` interface.
TypeScript structural typing is intentional here: concrete backends expose objects such as
`canvasDisplayListRenderer`; they do not need inheritance or a shared base class.

Current backend status:

- Web Canvas is the default production backend.
- `render/backends/canvas/**` owns Canvas drawing helpers, Canvas font serialization, and Canvas
  text measurement.
- `render/page/**` is only the Web Canvas facade that builds a display list and invokes the
  default Canvas backend.
- `render/spread/**` is only the Web Canvas facade over spread display-list construction.
- `@ritojs/core` exposes platform-neutral display-list builders and backend contracts.
- `@ritojs/core/advanced` exposes lower-level render internals for experimental backends.
- Flutter/Skia/native integrations should start from display lists plus platform adapters, not from
  `@ritojs/kit` or DOM controller code.

## Text Measurement Boundary

Text measurement is a platform capability, not a hidden Canvas dependency.

- layout-facing contracts are `TextMeasurer`, `FontMetricsProvider`, and structured `MeasurePaint`
- layout does not import Canvas APIs or font-string serializers
- the Web implementation is `canvasTextMeasurementBackend`
- non-Web integrations should provide equivalent text advance and font metric adapters before
  paginating

The default Canvas adapter resolves text advances and font metrics from `CanvasRenderingContext2D`.
Future Flutter/Skia/native backends can keep pagination deterministic by using the same contract
with their own font engine.
The construction path mirrors render backends: `TextMeasurementBackend<TTarget, TMeasurer>`
creates a `TextMeasurer`, and the Web implementation is `canvasTextMeasurementBackend`.
This is also a structural DI contract rather than an inheritance hierarchy.

## Resource Boundary

Browser resource APIs are isolated behind small adapter contracts:

- `FontRegistry` registers embedded EPUB fonts.
- `ImageDecoder` decodes EPUB image bytes into a backend-specific image handle.
- `ImageAssetResolver` resolves EPUB image references during rendering.
- `ImageObjectUrlProvider` is a separate Web-facing capability for blob URL creation.

The Web implementation uses `FontFace`, `createImageBitmap`, `Blob`, and Canvas text measurement.
Those types stay in Web adapter/backend modules; platform-neutral contracts use byte arrays,
logical dimensions, and resolver functions.

Directory placement follows that boundary:

- `render/assets/**` root implementations are platform-neutral and require injected adapters.
- `render/assets/web/**` owns browser-specific font, image decoding, and blob URL adapters.
- `render/web/resources.ts` remains the Web-default preparation path used by `createReader()`.

## Public API Strategy

The main `@ritojs/core` entry is platform-neutral:

- `loadEpub()`
- `paginate()` with caller-provided text measurement
- `buildSpreads()`
- `buildPageDisplayList()` / `buildSpreadDisplayList()`
- injected resource/backend contracts

Web Canvas convenience APIs are exposed through:

- `@ritojs/core/web` for `createReader()`, `prepare()`, `render()`, and Canvas adapters

The main entry should not re-export Web-only helpers. Any API that requires
`HTMLCanvasElement`, `CanvasRenderingContext2D`, `FontFace`, `Blob`,
`createImageBitmap`, or `document.fonts` belongs in the Web preset or an
advanced/internal module.

Lower-level capabilities are exposed through:

- `@ritojs/core/advanced`
- focused subpaths like `@ritojs/core/selection`, `@ritojs/core/search`, and `@ritojs/core/annotations`

This keeps browser app ergonomics available through `@ritojs/core/web` while
keeping the main entry stable for custom runtimes and tooling.

## Controller / UI Layer

The core `Reader` is not a full reading app surface.

That responsibility lives in higher layers:

- `@ritojs/kit` adds transitions, overlays, controller events, and app-facing orchestration
- `@ritojs/react` adds React lifecycle and state glue

## Testing Strategy

The repo relies on:

- unit tests across parser, style, layout, render, and interaction layers
- integration tests for public API and end-to-end core flow
- architecture invariants that guard key boundaries
- render-command and display-list summaries for backend diagnostics
- pixel golden tests for the Web Canvas backend

This is important because Rito implements its own EPUB-focused rendering pipeline instead of delegating layout to the browser.
