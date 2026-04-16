# Release & Versioning

This page describes how Rito should be packaged and versioned for public releases.

## Release Units

Public packages:

- `rito`
- `@rito/kit`
- `@rito/react`

Non-published workspace packages:

- `apps/reader`

The repository root package is a private workspace shell. It is intentionally not a published npm package,
so root-level `npm pack` is not a meaningful release check.

## Versioning Strategy

Rito should use lockstep versioning while it remains pre-1.0.

That means:

- all public packages share the same version
- same-version packages are the combinations tested together in CI
- internal package dependency ranges should remain compatible with the current public release line

This keeps the ecosystem easy to reason about during rapid iteration and avoids a
compatibility matrix between core, controller, and React integration layers.

Implementation note:

- the repo uses a linked Changesets group for `rito`, `@rito/kit`, and `@rito/react`
- each public release changeset should include all three public packages
- internal runtime dependencies between public packages should use `workspace:^` in source manifests

This is a pragmatic workaround for current upstream Changesets issues around `fixed` groups and
pre-1.0 versioning, where a minor release can be incorrectly promoted to `1.0.0`
([changesets/changesets#1759](https://github.com/changesets/changesets/issues/1759),
[changesets/changesets#1887](https://github.com/changesets/changesets/issues/1887)).

The `workspace:^` convention keeps local development pinned to the workspace and lets pnpm rewrite
those references to concrete semver ranges when packages are packed or published. This is the
recommended pnpm workspace flow:
[pnpm workspace protocol](https://pnpm.io/workspaces#publishing-workspace-packages),
[pnpm + changesets](https://pnpm.io/using-changesets).

## Changeset Workflow

Changesets is the source of truth for package version bumps.

Day-to-day flow:

1. run `pnpm changeset`
2. for public releases, select all three public packages: `rito`, `@rito/kit`, and `@rito/react`
3. choose `patch` or `minor`
4. write a short user-facing summary
5. commit the generated `.changeset/*.md` file with the code change

Release flow:

1. run `pnpm version-packages`
2. run `pnpm install` to refresh the workspace lockfile after version updates
3. review updated package versions and generated package changelog entries
4. update the root [`CHANGELOG.md`](../CHANGELOG.md) with a short release summary if desired
5. publish with `pnpm release:publish`

## Bump Rules

Use these rules for pre-1.0 releases:

- patch release: bug fixes, docs, internal refactors, packaging cleanup, low-risk additive work
- minor release: breaking API changes, changed runtime behavior that requires migration, new compatibility floors, export surface reshaping

## Changelog Policy

- use changesets entries as the versioning input
- let `pnpm version-packages` generate package changelog updates
- optionally keep the root [`CHANGELOG.md`](../CHANGELOG.md) as a concise repository-level release summary
- avoid filling changelogs with internal refactor noise unless it affects consumers

## Release Checklist

1. ensure the release has the right `.changeset/*.md` entries
2. run `pnpm version-packages`
3. run `pnpm install`
4. update package READMEs if entry points or usage guidance changed
5. update [`CHANGELOG.md`](../CHANGELOG.md) if you keep a root release summary
6. run `pnpm run check`
7. run `pnpm release:pack-check`
8. verify package metadata:
   - `description`
   - `homepage`
   - `repository`
   - `bugs`
   - `keywords`
   - dependency and peer dependency policy
   - `workspace:^` in source manifests for internal runtime deps
   - rewritten semver ranges in packed tarballs
9. before the first actual public publish:
   - choose and add a repository license
   - remove `private: true` from the public packages
   - publish the three public packages from the same release commit

For an exact step-by-step command sequence, use the [Release Runbook](./release-runbook.md).

## Compatibility Rule

Consumers should treat matching package versions as the supported combination.

Examples:

- `rito@0.5.5` + `@rito/kit@0.5.5` + `@rito/react@0.5.5` is a supported same-line combination
- mixed versions across release lines are not a compatibility target
