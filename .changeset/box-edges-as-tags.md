---
'@ritojs/core': patch
---

An inline element's start and end margin, border and padding take their width as Chromium's open and close tags do: a line that breaks where the element opens sends that start to the next line with the element's content, instead of leaving it on the line above or pushing the character before it down; nested elements each add their own, an empty element takes its width, vertical text reads the top and bottom sides, and percentage padding resolves against the containing block.
