---
'@ritojs/kit': major
'@ritojs/react': major
---

A custom page-turn effect can paint the frame itself: `paint(scene, frame)` gets the cleared canvas, each page's bitmap and overlay and the length of a CSS pixel in the frame's units (`scene.cssPixel`), for looks such as a curl (`layers` effects keep working and draw through the same scene). `transitionProgress` reports every painted frame of a turn with its progress from 0 to 1, and React adds `useReaderTransitionProgress(controller)`. The turn spring is solved in closed form each frame, so a turn follows the same path at any refresh rate (it was integrated per frame, and on 120Hz displays the default overshot the neighbour by about 4px, showing an empty strip at the edge). The presets are damped at critical or just above (`default` is now 180/27), so turns never bounce past the neighbour or back past the starting page, where there may be no page to show; a released drag hands its momentum to the spring (it was scaled down a thousandfold), bounded so that it cannot carry the turn past its target. The unused `margin` / `spreadGap` controller options are removed.
