# Development Documentation

These documents are for contributors and maintainers. They describe source
boundaries, migration plans, diagnostics, testing, and release operations.

They are not stable user-facing API documentation. Public usage docs stay in
the parent `docs/` directory, especially `getting-started.md`, `api/`,
`integrations/`, `capabilities.md`, and `limitations.md`.

## Architecture And Migration

- [Current Development Status](./current-status.md) — handoff entrypoint for
  the Rust-backed core migration; read this first when continuing development
- [Native Core Production Execution Plan](./native-core-production-plan.md) —
  active source of truth for the four-round HikariNagi C-end Web + Mobile RC,
  platform-neutral protocol, browser-grade cutover, hard gates, feature freeze,
  and legacy deletion order
- [Native Core Usability And Baseline Roadmap](./native-core-usability-roadmap.md) — active phase order: usable Rust reader, controlled DOM/WebView baseline transition, then long-term capability and performance work
- [Architecture](./architecture.md) — parser/style/layout/render/runtime boundaries and package layering
- [Browser Reader Thin Shell Plan](./browser-reader-thin-shell-plan.md) — hard targets for shrinking the browser TypeScript reader shell
- [Rust Core Plan](./native-core-rust-plan.md) — Rust engine migration plan and naming/product rules
- [Binary Wire V2 Evidence](./binary-wire-v2-evidence.md) — repeatable decode/ABBA results and the current default-wire decision
- [Native Reader Architecture](./native-reader-architecture.md) — native reader runtime lessons and retired session design notes
- [Native Reader UI Plan](./native-reader-ui-plan.md) — immersive Flutter reader shell, design language, interaction, motion, and UI roadmap
- [TypeScript Core Implementation Map](./ts-core-implementation-map.md) — reference implementation map for Rust parity work
- [CSS Engine Evaluation](./css-engine-evaluation-2026-07-18.md) — reproducible current Rust/TypeScript/Stylo correctness, performance, size, and adoption decision

## Operations

- [Testing Pipeline](./testing-pipeline.md) — unit, integration, structured golden, render golden, pixel, and e2e strategy
- [Rendering Diagnostics](./rendering-diagnostics.md) — Rito/reference/browser mismatch workflow
- [Release & Versioning](./releasing.md) — package publishing, changelog, and versioning policy
