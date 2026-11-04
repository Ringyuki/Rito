---
'@ritojs/core': patch
---

A box that breaks across pages paints as Chromium slices it: the fragment that breaks before or inside a child (or between a paragraph's lines) keeps the rest of the page, and no fragment strokes a border on an edge the break cut. A bordered box whose illustration moves to the next page draws its side borders down to the page bottom above it, with no bottom border there and no top border where it resumes.
