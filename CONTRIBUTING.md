# Contributing to Rito

Thanks for contributing to Rito.

The project is organized as a small set of public packages with strict architecture boundaries and a Changesets-based release flow.

## Repository Overview

This monorepo contains:

- `crates/rito-core` — the production EPUB, style, layout, render-payload, and reader runtime engine
- `crates/rito-wasm` — the browser-target WASM binding
- `packages/rito` — `@ritojs/core`, the public reader facade and browser binding shell
- `packages/rito-core-wasm` — private WASM build/decoder workspace whose output is bundled into `@ritojs/core`
- `packages/kit` — `@ritojs/kit`, the framework-agnostic controller layer
- `packages/react` — `@ritojs/react`, the React integration layer
- `apps/reader` — `@ritojs/reader`, a demo app that is not published to npm

The previous TypeScript engine is kept under
`packages/rito/src/reference/ts-core` for parity, goldens, and diagnostics. It
is not a production package entry or fallback implementation.

Public releases are lockstep-versioned across:

- `@ritojs/core`
- `@ritojs/kit`
- `@ritojs/react`
- `rito_flutter` (Dart/Flutter package, versioned independently, published to pub.dev)

`@ritojs/reader` is intentionally excluded from npm publishing.

## Before You Start

Requirements:

- Node.js 24
- pnpm 10.22.0 (pinned by the root `packageManager` field)
- a Rust toolchain compatible with the workspace `rust-version`
- the `wasm32-unknown-unknown` target and a `wasm-bindgen` CLI version matching
  the Rust dependency when building the real browser artifact

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

Use pull requests for normal contributions.

Typical flow:

1. create a branch from `master`
2. make a focused change
3. add or update tests when behavior changes
4. run local checks
5. open a PR targeting `master`

CI runs on pull requests targeting `master` (master is protected: all jobs
are required checks and branches must be up to date before merging, so the PR
round verifies the exact merge result). The pipeline fans out into parallel
jobs:

- Rust Checks (fmt, clippy, workspace tests)
- WASM Bindings (wasm target check, bindings build and node tests)
- Static Checks (dependency audit, typecheck, lint, format)
- Unit & Golden Tests
- Build & Pack (full build, DOM-free reference check, `release:pack-check`)
- Reader E2E, sharded four ways
- Pixel Golden on macOS, split by book range
- Coverage Gate

A separate non-blocking Pixel E2E workflow observes the canvas-pixel suites on
master pushes.

Please keep PRs focused. Small, single-purpose changes are easier to review and less likely to break the layout/render boundary.

## Changesets and Releases

Rito uses Changesets as the source of truth for version bumps.

If your change affects a published package, include a changeset in the same PR.

Published packages:

- `@ritojs/core`
- `@ritojs/kit`
- `@ritojs/react`

Non-published app:

- `@ritojs/reader`

### When You Need a Changeset

Add a changeset when your PR changes behavior, API, packaging, or user-facing docs for any published package.

You usually do not need a changeset when:

- the PR only touches `apps/reader`
- the PR is internal-only cleanup with no published-package impact
- the PR changes tests only

Create a changeset with:

```bash
pnpm changeset
```

For public releases, select all three public packages:

- `@ritojs/core`
- `@ritojs/kit`
- `@ritojs/react`

Versioning guidance (the packages follow semver from 1.0.0):

- `patch` — bug fixes, docs, packaging cleanup
- `minor` — backwards-compatible additions
- `major` — breaking API changes, renamed packages, runtime behavior changes that require migration, export-surface reshaping

### How Publishing Works

Publishing flow:

1. contributors merge normal PRs that include code and any needed changesets
2. every master push triggers the Release workflow; with pending changesets it
   opens or updates the automated `release: version packages` PR
3. maintainers review and merge that release PR
4. the next Release run detects the unpublished version, reruns the full check,
   publishes to npm (`latest`), creates GitHub releases, and tags
   `rito_flutter-vX.Y.Z` for the pub.dev OIDC workflow when needed

## Architecture Rules

These boundaries are not optional. Contributions should preserve them.

Core priorities:

1. strong typing
2. clear module boundaries
3. testability
4. maintainability
5. small public API

Key rules:

- keep EPUB, style, layout, render-payload, and runtime modules separated in Rust
- layout code must not depend on Canvas or browser APIs
- keep WASM bindings thin; reader policy belongs in `rito-core`
- keep browser APIs inside `packages/rito/src/bindings/browser`
- all public TypeScript exports must go through `packages/rito/src/index.ts`
- do not expose unstable internals
- do not import the TypeScript reference tree from production entries

### Engine / Presentation Boundary

The production Rust engine emits typed, paint-ready frame commands. The
TypeScript browser shell transfers and executes them; it must not reconstruct
layout or parse CSS values.

The TypeScript reference engine preserves its own layout/render boundary for
parity work. In practice:

- `render/**` must not import `ComputedStyle`
- `render/**` must not parse CSS strings
- render-only data belongs in paint objects, not top-level layout nodes
- `TextRun` carries `paint: RunPaint`, not `style: ComputedStyle`

These invariants are enforced by tests in:

- `packages/rito/tests/unit/architecture-invariants.test.ts`

If a change seems to require bypassing one of these rules, extend the paint types instead of collapsing layers.

## Code Expectations

Please match the repository conventions:

- use strict, warning-free Rust in the engine crates
- use TypeScript with strict typing in package and application code
- do not use `any` in `src`
- do not use default exports in `src`
- do not use `enum`
- prefer named exports
- prefer small, focused files
- soft file limit: 300 lines
- soft function limit: 40 lines

When changing public behavior, favor small, explicit APIs over broad surface expansion.

## Testing Expectations

Before opening a PR, run the relevant checks locally. Before considering a change done, the repository expectation is:

- lint passes
- typecheck passes
- tests pass
- Rust formatting, Clippy, and tests pass for native-core changes
- the project still builds

The standard command is:

```bash
pnpm run check
```

Native-core changes must additionally run:

```bash
pnpm run rust:check
pnpm run rust:wasm:verify
```

If your change is localized, it is fine to use narrower package-level commands while iterating. The final state should still satisfy the full workspace checks.

## Documentation Expectations

Update documentation when needed, especially if your PR changes:

- install names
- imports
- public APIs
- expected runtime behavior
- release or versioning behavior

Useful references:

- `README.md`
- `docs/development/architecture.md`
- `docs/development/releasing.md`
- `docs/integrations/kit.md`
- `docs/integrations/react.md`

## Pull Request Checklist

Before requesting review, confirm that:

- the change is scoped and described clearly
- tests were added or updated when behavior changed
- `pnpm run check` passes locally
- a changeset is included if a published package changed
- public API additions are intentional and minimal
- architecture boundaries were preserved

## Maintainer Notes

Maintainers should treat matching versions of `@ritojs/core`, `@ritojs/kit`, and `@ritojs/react` as the supported combination.

If you are preparing a release manually, see:

- `docs/development/releasing.md`
