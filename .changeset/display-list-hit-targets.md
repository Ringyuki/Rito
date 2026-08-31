---
'@ritojs/core': patch
---

Fragment-painted text and image commands carry the enclosing link's target and an image's alt text again. The fragment cutover shipped them as `None`, so a host resolving taps against the display list saw no links — a tap on a note anchor fell through to the image viewer.
