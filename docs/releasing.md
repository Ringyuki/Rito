# Release & Versioning

This page describes how Rito should be versioned and published from this monorepo.

## Release Units

Public packages:

- `@ritojs/core`
- `@ritojs/kit`
- `@ritojs/react`

Non-published workspace packages:

- `@ritojs/reader`

The repository root package is a private workspace shell. It is intentionally not
a published npm package.

## Versioning Strategy

Rito uses pre-1.0 lockstep versioning:

- all three public packages share the same version
- the tested, supported combination is the same version across all three packages
- internal runtime dependencies between public packages stay on `workspace:^` in source manifests

Implementation note:

- the repo uses a linked Changesets group for `@ritojs/core`, `@ritojs/kit`, and `@ritojs/react`
- each public release changeset should include all three public packages

The `workspace:^` convention keeps local development pinned to the workspace and lets
pnpm rewrite those references to concrete semver ranges when packages are packed or
published. This matches the recommended pnpm workspace flow:
[pnpm workspace protocol](https://pnpm.io/workspaces#publishing-workspace-packages),
[pnpm + changesets](https://pnpm.io/using-changesets).

## Changeset Workflow

Changesets is the source of truth for version bumps.

Day-to-day flow:

1. run `pnpm changeset`
2. for public releases, select `@ritojs/core`, `@ritojs/kit`, and `@ritojs/react`
3. choose `patch` or `minor`
4. write a short user-facing summary
5. commit the generated `.changeset/*.md` file with the code change

Release flow:

1. run `pnpm version-packages`
2. run `pnpm install`
3. review updated package versions and package changelog entries
4. update the root [`CHANGELOG.md`](../CHANGELOG.md) if you keep a repo-level release summary
5. publish with `pnpm release:publish`

If you make additional release-prep changes after a version has already been cut locally but before the first public publish, add an empty changeset with `pnpm changeset --empty`. That keeps `pnpm release:status` clean without forcing an unnecessary extra version bump.

Package changelogs under `packages/*/CHANGELOG.md` are written by Changesets when `pnpm version-packages` runs. The root [`CHANGELOG.md`](../CHANGELOG.md) is a repository-level summary and remains manual unless you decide to update it yourself.

The repository also includes an automated release workflow at [release.yml](../.github/workflows/release.yml). It uses `changesets/action` to open or update the version PR and, after that PR is merged, publish the packages with `pnpm release:ci`.

If you enable npm trusted publishing, configure each public package to trust the exact workflow filename `release.yml`. npm treats that filename as case-sensitive and exact-match.

## Bump Rules

Use these rules while the project remains pre-1.0:

- patch release: bug fixes, docs, packaging cleanup, low-risk additive work
- minor release: breaking API changes, renamed packages, changed runtime behavior that requires migration, export-surface reshaping

## Release Checklist

1. ensure the release has the right `.changeset/*.md` entries
2. run `pnpm version-packages`
3. run `pnpm install`
4. update package READMEs if install names, imports, or usage guidance changed
5. update [`CHANGELOG.md`](../CHANGELOG.md) if needed
6. run `pnpm run check`
7. run `pnpm release:pack-check`
8. verify package metadata:
   - `name`
   - `description`
   - `license`
   - `homepage`
   - `repository`
   - `bugs`
   - `keywords`
   - `workspace:^` in source manifests for internal runtime deps
   - rewritten semver ranges in packed tarballs
9. confirm npm auth and 2FA/token setup before publish

For the exact command sequence, use the [Release Runbook](./release-runbook.md).

## Compatibility Rule

Consumers should treat matching package versions as the supported combination.

Example:

- `@ritojs/core@0.6.0` + `@ritojs/kit@0.6.0` + `@ritojs/react@0.6.0` is a supported same-line combination
