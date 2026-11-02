---
'@ritojs/core': patch
---

An image or inline-block styled `vertical-align: middle` centres on its line as Chromium places it: its box moves by half its ascent less its descent, less half its parent's x-height, so its middle sits half the parent's x-height above the parent's baseline, down a vertical line too. calibre's centred plate pages, a page-wide spacer and a full-height block both aligned middle, now stand where Chromium draws them.
