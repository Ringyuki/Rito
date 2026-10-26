---
'@ritojs/core': patch
---

A paragraph's line edges (a closer trimmed to fit, a punctuation pair a break separates, a ruby base split across lines) are decided one line at a time as the line is broken, so a paragraph is built at most twice however many lines decide; a pair trim a later line moved away from its break is applied again, as Chromium applies it.
