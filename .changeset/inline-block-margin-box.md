---
'@ritojs/core': patch
---

An inline block stands on its line by its margin box, as Chromium lays it out: its margins, borders and padding surround its content, take their room along the line and push its last line's baseline down, so the line it rides grows by them (a translation wrapped in `display: inline-block; margin: 8px 0` sits 8px clear of the text above and below it).
