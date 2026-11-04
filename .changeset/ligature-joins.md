---
'@ritojs/core': patch
---

A ligature paints as one cluster from its start, and the cluster after it joins when the whole ligature steps by its glyph's advance, so the GPU pen and the canvas pen both draw the ligature the font forms: an embedded face's contextual pair of em dashes no longer paints as two isolated dashes a pixel above the browser's joined bar.
