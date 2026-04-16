# Release Runbook

This is the exact release procedure for the current Rito repository layout.

## Recommended Tag

Rito is still pre-1.0, so the recommended default for public npm releases is:

- `next`

Use `latest` only when you explicitly want normal installs to resolve to this line.

## Prerequisites

Before publishing:

1. confirm npm auth:
   - `npm whoami`
2. confirm your account or token satisfies npm publish 2FA requirements
3. confirm the public package names are:
   - `@rito/core`
   - `@rito/kit`
   - `@rito/react`

## Step 1: Confirm Pending Release State

From the repository root:

```bash
pnpm release:status
```

If you still need a release note entry, create one with:

```bash
pnpm changeset
```

For public releases in this repo, include all three public packages in the same changeset:

- `@rito/core`
- `@rito/kit`
- `@rito/react`

## Step 2: Apply Version Bumps

From the repository root:

```bash
pnpm version-packages
```

Review the result in:

- [packages/rito/package.json](/Users/ringyuki/Projects/Rito/packages/rito/package.json)
- [packages/kit/package.json](/Users/ringyuki/Projects/Rito/packages/kit/package.json)
- [packages/react/package.json](/Users/ringyuki/Projects/Rito/packages/react/package.json)

Confirm:

- all three package versions match
- the core package name is `@rito/core`
- `@rito/kit` depends on `@rito/core`
- `@rito/react` depends on `@rito/core` and `@rito/kit`

## Step 3: Refresh The Lockfile

```bash
pnpm install
```

## Step 4: Re-Audit Public Surface

Quickly re-check:

- root [README.md](/Users/ringyuki/Projects/Rito/README.md)
- package READMEs:
  - [packages/rito/README.md](/Users/ringyuki/Projects/Rito/packages/rito/README.md)
  - [packages/kit/README.md](/Users/ringyuki/Projects/Rito/packages/kit/README.md)
  - [packages/react/README.md](/Users/ringyuki/Projects/Rito/packages/react/README.md)
- release docs:
  - [docs/releasing.md](/Users/ringyuki/Projects/Rito/docs/releasing.md)
  - [docs/release-runbook.md](/Users/ringyuki/Projects/Rito/docs/release-runbook.md)

## Step 5: Run Full Verification

```bash
pnpm run check
```

Expected result:

- typecheck passes
- tests pass
- builds pass
- lint may still report the known warning-only backlog, but there must be `0` errors

## Step 6: Inspect Packed Tarballs

```bash
pnpm release:pack-check
```

This packs each public package with pnpm into a temporary directory and checks that:

- `README.md` is included
- `package.json` is included
- `dist/**` is included
- no `workspace:` dependency ranges remain in the packed `package.json`

## Step 7: Commit The Release

```bash
git add README.md docs CHANGELOG.md .changeset package.json pnpm-lock.yaml packages/rito packages/kit packages/react apps/reader/package.json scripts/check-release-tarballs.mjs
git commit -m "release: vX.Y.Z"
```

Replace `X.Y.Z` with the actual version.

## Step 8: Publish

Preferred command:

```bash
pnpm release:publish --tag next --otp <6-digit-code>
```

If you intentionally want the release to be the default install target, replace `next`
with `latest`.

If you publish with an automation token that bypasses 2FA, you can omit `--otp`.

## Step 9: Tag The Repository

After publish succeeds:

```bash
git tag vX.Y.Z
git push origin HEAD
git push origin vX.Y.Z
```

## Step 10: Post-Publish Verification

```bash
npm view @rito/core version dist-tags
npm view @rito/kit version dist-tags
npm view @rito/react version dist-tags
npm view @rito/core@next version
npm view @rito/kit@next version
npm view @rito/react@next version
```

## Quick Checklist

1. versions match across all three public packages
2. package names are `@rito/core`, `@rito/kit`, `@rito/react`
3. docs and READMEs reflect `@rito/core`
4. `pnpm run check` passed
5. `pnpm release:pack-check` passed
6. release commit created
7. `pnpm release:publish --tag <tag> --otp <code>` completed
8. git tag pushed
