# Changesets

Rito uses Changesets to manage version bumps and release publishing for the public packages in this monorepo.

Public release group:

- `@rito/core`
- `@rito/kit`
- `@rito/react`

These three packages are configured as a linked release group.

Project rule: every public release changeset should include all three public packages so the
ecosystem stays in lockstep.

Ignored workspace package:

- `@rito/reader`

Common commands:

```bash
pnpm changeset
pnpm release:status
pnpm release:pack-check
pnpm version-packages
pnpm release:publish --tag next
```

Guidance:

- create a changeset for every user-visible public-package change
- for public releases, include `@rito/core`, `@rito/kit`, and `@rito/react` together in the same changeset
- choose `patch` for fixes/docs/low-risk additive work
- choose `minor` for breaking or migration-relevant changes while the project remains pre-1.0
- keep internal public-package runtime dependencies on `workspace:^` in source manifests
- rely on pnpm pack/publish to rewrite `workspace:` ranges to concrete semver ranges in published tarballs
- use the release docs in `docs/releasing.md` and `docs/release-runbook.md` for the full workflow
