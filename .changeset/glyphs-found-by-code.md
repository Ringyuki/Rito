---
'@ritojs/core': patch
---

The GPU pen finds the glyph cells of a one-character cluster by its character code in an array, and writes each glyph quad straight into its batch, instead of a map lookup and a general quad call per cluster. Every pixel is the same.
