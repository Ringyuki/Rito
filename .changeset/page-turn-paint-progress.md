---
'@ritojs/kit': minor
'@ritojs/react': minor
---

A custom page-turn effect can paint the frame itself: `paint(scene, frame)` gets the cleared canvas and each page's bitmap and overlay, for looks such as a curl (`layers` effects keep working and draw through the same scene). `transitionProgress` reports every painted frame of a turn with its progress from 0 to 1, and React adds `useReaderTransitionProgress(controller)`. A released drag now hands its momentum to the spring (it was scaled down a thousandfold), and a committed turn stops at the neighbour instead of overshooting into a blank edge. The unused `margin` / `spreadGap` controller options are removed.
