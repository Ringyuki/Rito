---
'@ritojs/core': patch
---

A missing image with no `alt` attribute lays out as Chromium's 16px broken-image icon, as one with alt text does; only an empty `alt` collapses. A missing image in a short line no longer leaves every line after it a pixel high.
