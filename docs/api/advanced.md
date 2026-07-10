# Advanced Internals

`@ritojs/core` no longer exposes an `advanced` subpath.

The historical TypeScript internals are source-only reference code for
development, diagnostics, golden comparison, and Rust parity. They are not a
stable public API and should not be imported by applications or integration
packages.

For app-facing work:

- Use `@ritojs/core` for the Rust-backed reader.
- Use `@ritojs/kit` for controller-level interaction behavior.
- Use development diagnostics inside this repository when comparing against
  the old TypeScript implementation.
