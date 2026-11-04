---
'@ritojs/core': patch
---

A `<br>` breaks the line under `line-break: anywhere` and after a preserved space, a paragraph shaped as one run longer than 64 KiB lays out instead of failing, a ligature is measured by its own glyphs in any run, a line rewound to the start of an item keeps an inline image that comes before it, an ideographic space (or another space separator) that overflows a line hangs past its end where the line may break after it, as Chromium hangs it, and a short ruby (a base of at most four glyphs under an annotation of at most eight) moves to the next line whole instead of breaking inside its base, as Chromium keeps it.
