# Public Subpaths

`@ritojs/core` currently exposes only the root reader entry and
`./package.json`.

```ts
import { createReader, preloadReaderRuntime } from '@ritojs/core';
```

Legacy TypeScript helper entries such as `web`, `advanced`, `selection`,
`search`, `annotations`, `position`, `a11y`, and `dom` are no longer public
package subpaths. That code remains in the repository as a source-only
reference implementation for golden tests, diagnostics, and Rust parity work.

App integrations should use:

- `@ritojs/core` for the Rust-backed reader facade.
- `@ritojs/kit` for controller, selection/search/annotation orchestration,
  transitions, overlays, keyboard, and storage helpers.
- `@ritojs/react` for React hooks and components.

Development tooling that needs the old TypeScript implementation should import
the source reference from inside this repository, not from a published package
subpath.
