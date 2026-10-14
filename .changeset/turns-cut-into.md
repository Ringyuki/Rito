---
'@ritojs/kit': minor
---

A page turn cut into by another turn or by a finger no longer jumps: the turn in flight is settled at once and its picture carries on, the next turn beginning where the page is and as fast as it moves, with every built-in effect; a finger takes a moving page once it starts to drag, a release is judged by how far the finger carried the turn (`TransitionRelease.from` says where it took it), and a step by key during a turn that is going back is one spread, not two.
