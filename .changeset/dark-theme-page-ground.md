---
'@ritojs/core': patch
---

Theme overrides (dark/sepia) own the page ground again: the Rust core
materializes the book's body background for pixel parity, and the Canvas
renderer now substitutes the host theme background for it whenever a
foreground/background override is active, instead of letting the
materialized white bury the theme.
