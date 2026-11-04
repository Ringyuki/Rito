---
'@ritojs/core': patch
---

A block whose start lands past the end of the page, after a line or plate taller than the page, opens the next page however small it is, as Chromium breaks before it: a page-break `<div>` after an over-wide plate no longer hangs off the bottom of the plate's page.
