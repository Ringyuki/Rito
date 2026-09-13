# Contributing to Rito

Thanks for contributing to Rito.

The project is one Rust engine with several hosts, strict architecture
boundaries and a Changesets-based release flow.

## Repository Overview

- `crates/rito-core` — the engine: EPUB, XHTML, style projection, the
  fragment bridge, paint, lowering, the wire, interaction and the runtime
- `crates/rito-source`, `rito-style-contract`, `rito-stylo`,
  `rito-fragment`, `rito-block`, `rito-inline` — the source tree, typed
  style, the Stylo cascade and the layout crates
- `crates/rito-wasm` — the browser-target WASM binding
- `crates/rito-ffi` — the C ABI for native hosts
- `packages/rito` — `@ritojs/core`, the public reader facade and browser
  binding
- `packages/rito-core-wasm` — private WASM build and decoder workspace
  whose output is bundled into `@ritojs/core`
- `packages/kit` — `@ritojs/kit`, the framework-agnostic controller layer
- `packages/react` — `@ritojs/react`, the React integration layer
- `packages/rito_flutter` — the Flutter adapter, published to pub.dev
- `apps/reader` — `@ritojs/reader`, the demo app; not published

Public npm releases are lockstep-versioned across `@ritojs/core`,
`@ritojs/kit` and `@ritojs/react`. `rito_flutter` is versioned
independently.

## Before You Start

Requirements:

- Node.js 24
- pnpm 10.22.0 (pinned by the root `packageManager` field)
- the Rust toolchain pinned by the workspace `rust-version`
- the `wasm32-unknown-unknown` target and a `wasm-bindgen` CLI matching the
  Rust dependency when building the real browser artifact
- Flutter 3.41.7 or newer for `packages/rito_flutter`

Install dependencies:

```bash
pnpm install
```

Run the full verification suite:

```bash
pnpm run check
```

Useful local commands:

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run build
pnpm run rust:check
pnpm run rust:wasm:verify
pnpm --filter @ritojs/reader dev
```

## Contribution Workflow

Use pull requests for normal contributions:

1. create a branch from `master`
2. make a focused change
3. add or update tests when behaviour changes
4. run local checks
5. open a PR targeting `master`

CI runs on pull requests targeting `master` (master is protected: all
jobs are required checks and branches must be up to date before merging).
The pipeline fans out into parallel jobs: Rust Checks, WASM Bindings,
Static Checks, Unit & Golden Tests, Build & Pack, Reader E2E (sharded four
ways), Pixel Golden and the Coverage Gate. A separate non-blocking Pixel
E2E workflow observes the canvas-pixel suites on master pushes.

Keep PRs focused. Small, single-purpose changes are easier to review and
less likely to cross the engine/host boundary.

## Layout and paint changes

The engine is measured against pinned Chromium. A change to layout,
paint or lowering is verified with the pixel walk on real books before it
lands, and a change to a pen or the lowering also runs the paint-parity
instrument. See
[Verification Instruments](./docs/development/verification-instruments.md).
A rule is stated as a measured engineering fact in code comments — what
the browser does and how it was measured — not as an internal label.

## Changesets and Releases

Rito uses Changesets as the source of truth for version bumps. Include a
changeset in the same PR when your change affects behaviour, API,
packaging or user-facing docs of a published package. You usually do not
need one when the PR only touches `apps/reader`, is internal-only cleanup
with no published-package impact, or changes tests only.

```bash
pnpm changeset
```

For public releases select all three public packages. Versioning follows
semver from 1.0.0: `patch` for fixes, docs and packaging cleanup, `minor`
for backwards-compatible additions, `major` for breaking API changes,
renamed packages, runtime behaviour changes that require migration and
export-surface reshaping.

Publishing: every master push runs the Release workflow; with pending
changesets it opens or updates the `release: version packages` PR, and
the next run after that PR merges reruns the full check, publishes to
npm, creates GitHub releases and tags the Flutter release. Details are in
[Release & Versioning](./docs/development/releasing.md).

## Architecture Rules

These boundaries are not optional:

- Rust owns parsing, style, layout, pagination, paint and interaction
  geometry; hosts transport bytes and blit
- keep EPUB, style, layout, render and runtime modules separated in Rust
- layout and paint code must not depend on Canvas or browser APIs
- the display list is typed end to end; no JSON or CSS strings on the
  production path
- keep WASM and FFI bindings thin; reader policy belongs in `rito-core`
- keep browser APIs inside `packages/rito/src/bindings/browser`
- all public TypeScript exports go through `packages/rito/src/index.ts`
- the engine, the wire encoder and every decoder change in the same commit
- do not expose unstable internals

These invariants are enforced by
`crates/rito-core/tests/render_architecture_invariants.rs`,
`packages/rito/tests/unit/architecture-invariants.test.ts`,
`packages/rito/tests/unit/browser-reader-architecture-invariants.test.ts`
and `packages/rito_flutter/test/architecture_test.dart`. If a change
seems to require bypassing one of them, extend the typed paint model
instead of collapsing layers.

## Code Expectations

- strict, warning-free Rust in the engine crates; `cargo clippy -D
warnings` is a gate
- TypeScript with strict typing, no `any`, no default exports, no enums,
  small focused files
- Prettier formatting and the ESLint flat config
- tests for behaviour changes in every suite that encodes the behaviour
