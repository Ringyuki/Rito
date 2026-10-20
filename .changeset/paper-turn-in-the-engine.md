---
'@ritojs/core': minor
'@ritojs/kit': minor
---

The paper turn's motion and geometry are the engine's: `loadPaperTurnModel()` in `@ritojs/core` resolves to the engine's model of the turn, and `createPaperTurn()` draws what it lays out, frame for frame what it drew before. Until the engine has loaded, a paper turn is drawn as the built-in `cover` and moved by the built-in physics; `PaintedTransitionEffect.physics` may be `undefined` for that while.
