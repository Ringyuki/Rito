---
'@ritojs/core': patch
---

A text run marks every cluster the one before it reaches by its bare glyph advance (no spacing, justification or kerning added, the same face, left to right), and the pen draws such a cluster in the same string. A page of justified Latin text was drawn in one canvas call per character and is now drawn in one per stretch between justification points and kern pairs; every pixel is the same. Every cluster keeps its origin, carried at the float32 precision the canvas takes it at, and the decoder holds a run's clusters in typed arrays instead of an object per cluster.
