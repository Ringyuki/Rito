---
'@ritojs/core': patch
---

The GPU pen paints text only where the canvas is Chromium's, the one whose glyph placement it reproduces; in Safari and Firefox every page is painted by the canvas pen and copied in, so pages there show the pixels their own canvas paints.
