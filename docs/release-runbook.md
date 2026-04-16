# Release Runbook

This is the exact release procedure for the current Rito repository layout.

## Recommended Tag

Rito is still pre-1.0 and the root README explicitly says it is not recommended for
production use yet.

Recommended default for the first public npm release:

- publish with the npm dist-tag `next`

Use `latest` only when you explicitly want normal installs to resolve to this line.

## One-Time First-Publish Tasks

Do these once before the first real public publish:

1. choose a license
2. add a repository-level `LICENSE` file
3. add matching `license` fields to:
   - `packages/rito/package.json`
   - `packages/kit/package.json`
   - `packages/react/package.json`
4. remove `private: true` from those same three package manifests

Before every real publish, confirm npm auth for the target registry:

```bash
npm whoami
```

## Release Inputs

Decide these before editing anything:

- target version, for example `0.5.6` or `0.6.0`
- npm dist-tag, recommended: `next`

## Step 1: Bump Versions In Lockstep

Edit these files together:

- [packages/rito/package.json](/Users/ringyuki/Projects/Rito/packages/rito/package.json)
- [packages/kit/package.json](/Users/ringyuki/Projects/Rito/packages/kit/package.json)
- [packages/react/package.json](/Users/ringyuki/Projects/Rito/packages/react/package.json)

Rules:

- all three public packages use the same version
- `@rito/kit` peer dependency on `rito` must match that release line
- `@rito/react` peer dependencies on `rito` and `@rito/kit` must match that release line

## Step 2: Update Release Notes

Update:

- [CHANGELOG.md](/Users/ringyuki/Projects/Rito/CHANGELOG.md)

Move the relevant items out of `Unreleased` into a new version heading, for example:

```md
## [0.5.6] - 2026-04-16
```

## Step 3: Re-Audit Package Surface

Before publishing, quickly re-check:

- root [README.md](/Users/ringyuki/Projects/Rito/README.md)
- package READMEs:
  - [packages/rito/README.md](/Users/ringyuki/Projects/Rito/packages/rito/README.md)
  - [packages/kit/README.md](/Users/ringyuki/Projects/Rito/packages/kit/README.md)
  - [packages/react/README.md](/Users/ringyuki/Projects/Rito/packages/react/README.md)
- docs index and release docs:
  - [docs/README.md](/Users/ringyuki/Projects/Rito/docs/README.md)
  - [docs/releasing.md](/Users/ringyuki/Projects/Rito/docs/releasing.md)

Confirm they still match the current public exports and release posture.

## Step 4: Run Full Verification

From the repository root:

```bash
pnpm run check
```

Expected result:

- typecheck passes
- tests pass
- builds pass
- lint may still report the known warning-only backlog, but there must be `0` errors

## Step 5: Inspect Tarballs

Run:

```bash
(cd packages/rito && npm pack --dry-run)
(cd packages/kit && npm pack --dry-run)
(cd packages/react && npm pack --dry-run)
```

If your local npm cache has permission issues, use:

```bash
npm_config_cache=/tmp/rito-npm-cache npm pack --dry-run
```

Confirm each tarball includes:

- `README.md`
- `package.json`
- `dist/**`

And does not include unintended source or app files.

## Step 6: Commit The Release

Create a release commit from the repository root:

```bash
git add README.md docs CHANGELOG.md packages/rito/package.json packages/rito/README.md packages/kit/package.json packages/kit/README.md packages/react/package.json packages/react/README.md
git commit -m "release: vX.Y.Z"
```

Replace `X.Y.Z` with the actual version.

## Step 7: Publish In Package Order

Publish core first, then integrations:

```bash
pnpm --filter rito publish --tag next --access public --no-git-checks
pnpm --filter @rito/kit publish --tag next --access public --no-git-checks
pnpm --filter @rito/react publish --tag next --access public --no-git-checks
```

If you intentionally want the release to be the default install target, replace `next`
with `latest`.

## Step 8: Tag The Repository

After publish succeeds:

```bash
git tag vX.Y.Z
git push origin HEAD
git push origin vX.Y.Z
```

## Step 9: Post-Publish Verification

Check package metadata from the registry:

```bash
npm view rito version dist-tags
npm view @rito/kit version dist-tags
npm view @rito/react version dist-tags
npm view rito@next version
npm view @rito/kit@next version
npm view @rito/react@next version
```

## Quick Checklist

1. version bumped in all three public packages
2. peer ranges updated
3. changelog updated
4. docs and package READMEs checked
5. `pnpm run check` passed
6. `npm pack --dry-run` checked for all three packages
7. release commit created
8. publish order: `rito` -> `@rito/kit` -> `@rito/react`
9. git tag pushed
