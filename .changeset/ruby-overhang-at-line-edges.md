---
'@ritojs/core': patch
---

A ruby whose annotation is wider than its base overhangs the text before it only when that text is on its own line, as Chromium lays it out: a ruby opening a line starts its annotation at the line's start. A justified, centered or right-aligned line that ends where the next element's first character did not fit aligns as Chromium aligns it, counting each ruby on it at its full width, so such a line ending at a ruby is not stretched.
