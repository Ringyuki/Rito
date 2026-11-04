---
'@ritojs/kit': minor
---

A scroll view says which of the app's highlights the pointer is on, the one drawn on top: its `tap` event carries `highlight` (the highlight's `id` and its `bounds` in screen coordinates), and the new `highlightHover` event tells the one under a resting mouse each time it changes or the strip moves it, null once the mouse leaves or presses, so an app opens an annotation's editor on a tap and shows its tooltip on hover in a scrolled view as a page view's `annotationClick` and `annotationHover` let it.
