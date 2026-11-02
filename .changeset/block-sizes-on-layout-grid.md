---
'@ritojs/core': patch
---

A box's fixed, minimum and maximum block size sits on the LayoutUnit grid, truncated as Chromium stores a used size: paragraphs held to `min-width: 1.6em` down a vertical page stack 25.59375px apart instead of 25.6, so their excess no longer piles up over a page and moves where the next page's lines start.
