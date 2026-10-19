---
'@ritojs/core': patch
---

A text run's clusters are written once into a table of exactly their count, and the display list's cluster and text tables are sized once for every run they hold, instead of growing as each cluster arrives and being copied again. Every byte of the display list is the same.
