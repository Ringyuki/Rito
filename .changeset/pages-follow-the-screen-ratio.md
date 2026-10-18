---
'@ritojs/core': minor
'@ritojs/kit': minor
---

The pages are laid out again at the screen's pixel ratio when the page zooms or the window goes to another screen, instead of stretched: `reader.setDevicePixelRatio(ratio)` lays the book out at a new ratio and the controller calls it, and the display canvas is shown pixel for pixel unless a pinch magnifies it.
