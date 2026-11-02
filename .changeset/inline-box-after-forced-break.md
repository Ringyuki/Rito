---
'@ritojs/core': patch
---

An inline-block right after a forced break starts the next line when a box measures its content's widest line, as Chromium measures it: a shrink-to-fit table column holding `text<br><inline-block>` takes the wider of the two lines instead of their sum, and an inline box opening there brings its padding along.
