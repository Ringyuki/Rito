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
`createPaperTurn()` draws it; make one model per reader. Its `motion` is
the numbers the paper moves by (`PaperTurnMotion`: how a leaf let go comes
to rest, how far or how fast a finger must pull for it to turn), the
engine's defaults until `configure` gives others.

`loadTurnMotion()` resolves to a maker of the engine's motion of any page
turn (`TurnMotion`): the finger while it holds the turn, the release that
decides it, the spring that carries it to rest, a pull against the end of
the book and a turn another cuts into. `loadedTurnMotion()` gives the same
maker at once once the engine is loaded, as it is when a reader has opened.
Wherever its built-in rules decide, a host may answer with physics of its
own instead.

`loadedTurnController()` gives a maker of the engine's page turns of a
reader (`TurnController`), the same on every host: the host tells it what
happens (a finger, a key, a jump, a page painted, a frame) with what it
knows of the pages beside the one shown, and carries out what it decides as
actions: a turn has begun, lands (the reader is on its spread from then),
needs its page, has ended. A turn lands when it is decided — a key's at
once, a finger's when it lets go past the threshold — and one that goes
back never moved the reader. Where it asks a question (where a turn cut
into begins, whether a release lands), the host's physics may answer.
`@ritojs/kit`'s turns are carried out this way.

There are no package subpaths. Controller-level selection, search,
annotations, accessibility, storage, transitions and DOM wiring belong in
`@ritojs/kit`; React glue belongs in `@ritojs/react`. The private
`@ritojs/core-wasm` workspace is a build input of `@ritojs/core`, not a
runtime dependency, and is not published.
