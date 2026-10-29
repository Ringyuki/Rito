---
'@ritojs/core': patch
---

On a justified line, each inline item (a ruby pair, a styled span, the text between them) ends at the 1/64px ceiling of its exact advance, its glyphs' fixed-point advances plus its justification shares, as Chromium snaps an item's width; a share that lifts an item only slightly past a grid point no longer leaves it on the point below.
