# Architecture

Rito is organized around explicit boundaries:

1. parse EPUB/XHTML
2. resolve styles
3. compute layout and pagination
4. render paint-ready output
5. optionally layer interaction/controller logic on top

## Package Layering

```text
packages/rito/
  src/index.ts      Public API (createReader + stable primitives)
  src/advanced.ts   Expert-facing lower-level API
  src/reader/       Reader facade
  src/parser/       EPUB structure + XHTML parsing
  src/style/        CSS subset parsing + cascade resolution
  src/layout/       Pure layout + pagination + spread building
  src/render/       Canvas rendering + browser resource preparation
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

## Public API Strategy

The main `@ritojs/core` entry is intentionally small:

- `createReader()`
- stable high-level primitives
- a curated set of stable types

Lower-level capabilities are exposed through:

- `@ritojs/core/advanced`
- focused subpaths like `@ritojs/core/selection`, `@ritojs/core/search`, and `@ritojs/core/annotations`

This keeps the main entry practical for app developers while still making expert tooling possible.

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

This is important because Rito implements its own EPUB-focused rendering pipeline instead of delegating layout to the browser.
