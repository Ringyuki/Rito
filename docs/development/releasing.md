# Release & Versioning

This page describes how Rito should be versioned and published from this monorepo.

## Release Units

Public packages:

- `@ritojs/core`
- `@ritojs/kit`
- `@ritojs/react`

Non-published workspace packages:

- `@ritojs/reader`
- `@ritojs/core-wasm` (private WASM build/decoder workspace)

The independently versioned `rito_flutter` package is published to pub.dev.
It does not participate in the npm lockstep Changesets group.

The repository root package is a private workspace shell. It is intentionally not
a published npm package.

The Rust-backed `@ritojs/core` package consumes `@ritojs/core-wasm` only as a
workspace build input. Its build bundles the binding and decoder code and
copies the generated `.wasm` into the public tarball. `pnpm release:pack-check`
rejects private workspace runtime dependencies/imports, validates the WASM
artifact, and smoke-tests an isolated install and import. Keep that invariant
green before publication.

## Versioning Strategy

Rito uses lockstep versioning (semver from 1.0.0):

- all three public packages share the same version
- the tested, supported combination is the same version across all three packages
- internal runtime dependencies between public packages stay on `workspace:^` in source manifests

Implementation note:

- the repo uses a fixed Changesets group for `@ritojs/core`, `@ritojs/kit`, and `@ritojs/react`
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
3. choose `patch`, `minor`, or `major` (breaking changes are `major`)
4. write a short user-facing summary
5. commit the generated `.changeset/*.md` file with the code change

Release flow:

1. run `pnpm version-packages`
2. run `pnpm install`
3. review updated package versions and package changelog entries
4. update the root changelog if you keep a repo-level release summary
5. publish with `pnpm release:publish`

If you make additional release-prep changes after a version has already been cut locally but before the first public publish, add an empty changeset with `pnpm changeset --empty`. That keeps `pnpm release:status` clean without forcing an unnecessary extra version bump.

Package changelogs under `packages/*/CHANGELOG.md` are written by Changesets when `pnpm version-packages` runs. A root changelog, if the repository adds one later, is a repository-level summary and remains manual unless you decide to update it yourself.

The repository also includes an automated release workflow at
[release.yml](../../.github/workflows/release.yml). It runs on every master
push (PRs are the verification round; master is protected by required checks),
uses `changesets/action` to open or update the version PR and, after that PR
is merged, publish the packages with `pnpm release:ci` — which reruns the full
check before publishing — and create the GitHub releases. Once npm publishing
succeeds, the same workflow creates the
unpublished `rito_flutter-vX.Y.Z` tag; that tag starts `flutter-release.yml`,
which validates and publishes the matching Flutter package through pub.dev
OIDC.

GitHub suppresses workflows caused by refs created with the default
`GITHUB_TOKEN`. Configure a repository secret named `RELEASE_GITHUB_TOKEN` with
a non-`GITHUB_TOKEN` credential whose events may trigger Actions workflows. A
fine-grained PAT with repository Contents read/write permission is preferred;
the authenticated GitHub CLI OAuth token is also supported when it has `repo`
and `workflow` scopes. The credential must be allowed to push the release tag
under the repository's tag rules. It creates only the Flutter release tag; npm
authentication remains npm trusted publishing and Flutter authentication
remains pub.dev OIDC.

If you enable npm trusted publishing, configure each public package to trust the exact workflow filename `release.yml`. npm treats that filename as case-sensitive and exact-match.

## Flutter package release

`packages/rito_flutter` is released by
[`flutter-release.yml`](../../.github/workflows/flutter-release.yml) when the
main Release workflow creates a tag matching `rito_flutter-vX.Y.Z`. The tag
version must equal the `pubspec.yaml` version. A manually pushed matching tag
uses the same workflow as a recovery path.

Before tagging:

1. update `packages/rito_flutter/pubspec.yaml` and `CHANGELOG.md`
2. run `pnpm flutter:release:prepare` to assemble the tracked `rito-ffi` Rust
   dependency closure under the package's ignored `native/` directory
3. from `packages/rito_flutter`, run `dart analyze`, `flutter test`, and
   `dart pub publish --dry-run`
4. inspect the dry-run file list and confirm that `LICENSE`, `native/Cargo.toml`,
   `native/Cargo.lock`, and all required crates are present
5. commit the release preparation and its npm changeset; do not create the tag
   manually during the normal coordinated release flow

The generated `native/` directory and package-local `LICENSE` are not committed.
`.pubignore` deliberately includes them in the published archive. The release
workflow regenerates the closure from the tagged repository and validates it
before publishing through pub.dev OIDC. Configure the package's pub.dev
automated publishing rule for repository `Ringyuki/Rito` and tag pattern
`rito_flutter-v{{version}}`.

The normal coordinated sequence is:

1. merge the feature PR to `master`; the Release workflow creates or updates
   the Release PR
2. merge the Release PR; the next Release run republishes after its own full
   check
3. after npm succeeds, `release.yml` creates the Flutter version tag with
   `RELEASE_GITHUB_TOKEN`
4. the tag-triggered Flutter workflow publishes the version to pub.dev

If the Flutter version already exists on pub.dev, the tag step is skipped. If
the tag exists but pub.dev does not have the version, rerun the failed
`flutter-release` workflow for that tag instead of moving or recreating it.

## Bump Rules

Semver applies from 1.0.0:

- patch release: bug fixes, docs, packaging cleanup
- minor release: backwards-compatible additive work
- major release: breaking API changes, renamed packages, changed runtime behavior that requires migration, export-surface reshaping

## Release Checklist

1. ensure the release has the right `.changeset/*.md` entries
2. run `pnpm version-packages`
3. run `pnpm install`
4. update package READMEs if install names, imports, or usage guidance changed
5. update the root changelog if needed
6. run `pnpm run check`
7. run `pnpm test:coverage`, `pnpm test:e2e`, and `pnpm test:golden:pixel`
8. run `pnpm release:pack-check`
9. verify package metadata:
   - `name`
   - `description`
   - `license`
   - `homepage`
   - `repository`
   - `bugs`
   - `keywords`
   - `workspace:^` in source manifests for internal runtime deps
   - rewritten semver ranges in packed tarballs
10. verify no public tarball depends on a private workspace package
11. confirm npm auth and 2FA/token setup before publish

## Compatibility Rule

Consumers should treat matching package versions as the supported combination.

Example:

- `@ritojs/core@1.0.0` + `@ritojs/kit@1.0.0` + `@ritojs/react@1.0.0` is a supported same-line combination
