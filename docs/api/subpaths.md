# Public Entry

`@ritojs/core` exposes the root entry and `./package.json` only.

```ts
import { createReader, loadPaperTurnModel, preloadReaderRuntime } from '@ritojs/core';
```

`createReader()` is the browser's one host of the reader session: the
session, the engine it runs on the page's thread and the Canvas pen it
paints with are internal to it.

`loadPaperTurnModel()` resolves to the engine's model of the paper page
turn, on the same instance of the engine as the reader: frames in, each
sheet's points and the pages its faces show out. `@ritojs/kit`'s
`createPaperTurn()` draws it; make one model per reader.

There are no package subpaths. Controller-level selection, search,
annotations, accessibility, storage, transitions and DOM wiring belong in
`@ritojs/kit`; React glue belongs in `@ritojs/react`. The private
`@ritojs/core-wasm` workspace is a build input of `@ritojs/core`, not a
runtime dependency, and is not published.
