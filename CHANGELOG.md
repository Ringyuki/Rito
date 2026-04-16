# Changelog

All notable changes to this repository should be recorded in this file.

The format is based on Keep a Changelog. While Rito remains pre-1.0, minor releases are
used for public API or compatibility changes and patch releases are used for fixes,
docs, and low-risk additive work.

## [Unreleased]

### Changed

- slimmed the root README and moved detailed package/API guidance into `docs/`
- added dedicated package READMEs for `rito`, `@rito/kit`, and `@rito/react`
- removed worker pagination support from the current public release plan
- fixed `setTypography()` refresh propagation in `@rito/kit`
- fixed stale async load races and SSR-safe render behavior in `@rito/react`
