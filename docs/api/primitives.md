# Reference Primitives

The old TypeScript parser/layout/render primitives are no longer public
`@ritojs/core` package APIs.

They remain in the repository under `packages/rito/src/reference/ts-core/**`
only to support:

- Rust parity work.
- Golden and diagnostic tooling.
- Source-level investigations when comparing the Rust implementation against
  the historical TypeScript behavior.

Application code should not import these primitives. Use the root
`@ritojs/core` reader facade, plus `@ritojs/kit` or `@ritojs/react` for UI
orchestration.

Reference code has no package export and carries no compatibility guarantee.
Repository tooling should import it through the local source-only reference
facade; published consumers must not rely on its file layout.

## Related Docs

- [Reader API](./reader.md)
- [Advanced Internals](./advanced.md)
