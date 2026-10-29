---
'@ritojs/core': patch
---

An inline table (`display: inline-table`) moves to the next page whole when it does not fit what is left of the page, as Chromium fragments an atomic inline, instead of breaking between its rows like a block table.
