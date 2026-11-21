---
'@ritojs/core': minor
'@ritojs/kit': minor
---

When a page turn begins, lands and ends, and what a finger, a key or a jump does to a turn on screen, is decided by the engine, one model for every host: `loadedTurnController()` makes a `TurnController` that a host tells what happens and whose actions it carries out. The kit's turns are carried out this way. A turn now lands the reader on its spread when it is decided — a key's as it begins, a finger's when it is let go to turn — and `spreadChange` and `currentSpread` follow then: a drag the finger still holds, or one that goes back, no longer moves the reader and puts it back. Each key pressed during a turn turns a page, a key the way a turn is going back sends it on, a finger holding the page keeps keys from it, and a turn waiting for its page gives way to whatever the reader is asked next, a finger included.
