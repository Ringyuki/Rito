---
'@ritojs/core': patch
---

Consecutive text runs are drawn under one saved canvas state and one scale instead of saving, scaling and restoring around every run, so a run whose font and ink match the run before it sets nothing the canvas has to parse again. Every pixel is the same.
