---
'@ritojs/core': minor
'@ritojs/kit': patch
---

Resizing the reader re-lays the page every frame. The whole-book layout started again after every new size and held the session for as long as the book takes (240 ms for a 400-page novel, 1.3 s for an 800-page one), so each size after it waited: dragging a window's edge showed 8 layouts a second for the first book and 1.5 for the second while the window sent 55. `controller.resize()` in `@ritojs/kit` now holds the whole-book layout back until no size has come for 300 ms, and every size of the drag reaches the screen.

`reader.holdBookLayout()` in `@ritojs/core` is the hold kit takes: it keeps the whole-book layout from starting until the function it returns is called (holds nest), for a host about to ask for layouts in quick succession.
