---
'@ritojs/core': patch
---

A paragraph is broken into lines once per width: the lines a build of it was broken into are kept with the build, so laying a page out again with its text after pagination broke its paragraphs, or turning back to it, puts them back instead of breaking the paragraphs again. Every page is the same.
