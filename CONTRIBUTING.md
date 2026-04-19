# Contributing to Rito

Thanks for contributing to Rito.

The project is organized as a small set of public packages with strict architecture boundaries and a Changesets-based release flow.

## Repository Overview

This monorepo contains:

- `packages/rito` — `@ritojs/core`, the parser/layout/rendering engine
- `packages/kit` — `@ritojs/kit`, the framework-agnostic controller layer
- `packages/react` — `@ritojs/react`, the React integration layer
- `apps/reader` — `@ritojs/reader`, a demo app that is not published to npm

Public releases are lockstep-versioned across:

- `@ritojs/core`
- `@ritojs/kit`
- `@ritojs/react`

`@ritojs/reader` is intentionally excluded from npm publishing.

## Before You Start

Requirements:

- Node.js 24
- pnpm 10

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

CI runs on both pushes to `master` and pull requests targeting `master`. The CI workflow currently verifies:

- `pnpm run check`
- `pnpm release:pack-check`

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

Versioning guidance while the project is pre-1.0:

- `patch` — bug fixes, docs, packaging cleanup, low-risk additive work
- `minor` — breaking API changes, renamed packages, runtime behavior changes that require migration, export-surface reshaping

### How Publishing Works

Publishing is a two-step process:

1. contributors merge normal PRs that include code and any needed changesets
2. the release workflow opens or updates an automated `release: version packages` PR
3. maintainers review and merge that release PR
4. after that merge, the workflow publishes packages

At the moment, automated publishes go to the npm `next` dist-tag, not `latest`.

## Architecture Rules

These boundaries are not optional. Contributions should preserve them.

Core priorities:

1. strong typing
2. clear module boundaries
3. testability
4. maintainability
5. small public API

Key rules:

- keep parser, layout, render, and runtime separated
- layout code must not depend on Canvas APIs
- render code may depend on Canvas APIs
- all public exports must go through `src/index.ts`
- do not expose unstable internals

### Layout / Render Boundary

The most important invariant is the layout/render boundary in `packages/rito`.

Layout and render communicate through explicit paint-ready types. In practice:

- `render/**` must not import `ComputedStyle`
- `render/**` must not parse CSS strings
- render-only data belongs in paint objects, not top-level layout nodes
- `TextRun` carries `paint: RunPaint`, not `style: ComputedStyle`

These invariants are enforced by tests in:

- `packages/rito/tests/unit/architecture-invariants.test.ts`

If a change seems to require bypassing one of these rules, extend the paint types instead of collapsing layers.

## Code Expectations

Please match the repository conventions:

- use TypeScript with strict typing
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
- the project still builds

The standard command is:

```bash
pnpm run check
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
- `docs/architecture.md`
- `docs/releasing.md`
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

- `docs/releasing.md`
