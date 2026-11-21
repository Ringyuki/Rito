---
'@ritojs/core': minor
'@ritojs/kit': minor
---

A page turn's motion is the engine's, one implementation for every host: `loadTurnMotion()` (and `loadedTurnMotion()` once a reader has opened) makes a `TurnMotion` — the finger while it holds the turn, the release that decides it, the spring that carries it to rest, a pull against the end of the book, and a turn cut into by another — whose built-in rules take the numbers a host sets, and where physics of the host's own may answer any decision instead. The kit's turns move by it, its `TransitionPhysics` hooks answering where they are given; the turns' paths are the ones they were to within a millionth of a pixel. The paper turn moves by numbers it is given: `PaperTurnModel.motion` and `configure`, and `createPaperTurn({ motion })` (`PaperTurnMotion`), the engine's defaults in their absence.
