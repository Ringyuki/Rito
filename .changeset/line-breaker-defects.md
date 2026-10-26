---
'@ritojs/core': patch
---

A `<br>` breaks the line under `line-break: anywhere` and after a preserved space, a paragraph shaped as one run longer than 64 KiB lays out instead of failing, a ligature is measured by its own glyphs in any run, and a line rewound to the start of an item keeps an inline image that comes before it.
