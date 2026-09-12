# Development Documentation

These pages are for contributors and maintainers. They describe the
source: boundaries, the engine pipeline, the wire format, the test
pipeline, the instruments and release operations. They are not stable
user-facing API documentation; public usage docs live in the parent
`docs/` directory.

## Architecture

- [Architecture](./architecture.md) — crates, packages, boundaries and
  the invariants the guards enforce
- [Engine Pipeline](./engine-pipeline.md) — a chapter from the archive to
  the bytes a host blits, stage by stage
- [Wire Format](./wire-format.md) — `RITODL1` format 2

## Operations

- [Testing Pipeline](./testing-pipeline.md) — the gates and what each one
  catches
- [Verification Instruments](./verification-instruments.md) — the pixel
  walk, paint parity, line baselines, the diagnostics hook
- [Release & Versioning](./releasing.md) — package publishing, changesets
  and the Flutter release
