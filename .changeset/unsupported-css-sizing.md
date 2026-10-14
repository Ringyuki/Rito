---
'@ritojs/core': patch
---

A block or image sized with `fit-content`, `min-content`, `max-content`, `fit-content()`, `-webkit-fill-available` or `stretch` no longer fails its chapter's layout; previously a single `width: fit-content` card stopped pagination at that chapter. Until these sizes are computed they lay out as `auto` (an image keeps its natural size), an intrinsic `max-width` caps nothing, and the rest of the element's style — numeric widths and caps, padding, margins and borders — still applies. Floats with `stretch` or `-webkit-fill-available` fill the available width; the other keywords shrink to fit. Each fallback is reported among the chapter's layout degradations.
