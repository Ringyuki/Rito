---
'@ritojs/core': patch
---

An element styled `display: inline-block` lays out as Chromium's atomic inline whatever its tag: it takes its own `width` and `height` (a percentage across a vertical line resolving against the page when the line's own size is open, as Chromium's orthogonal fallback does), an empty one still stands on its line at its size, and one holding blocks lays them out inside it. calibre's centred-plate pages now land on the page Chromium shows them on, with the plate centred across it.
