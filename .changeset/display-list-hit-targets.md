---
'@ritojs/core': patch
---

Fragment-painted text and image commands carry the enclosing link's target and an image's alt text again. The fragment cutover shipped them as `None`, so the hit entries a host resolves taps against carried no links — a tap on a note anchor fell through to the image viewer.
