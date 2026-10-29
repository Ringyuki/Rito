---
'@ritojs/core': patch
---

A line's last glyph is measured as Chromium reshapes a line's end: where the shaper marks the break after it unsafe (a kern pair with the space that hangs after it, as Tinos kerns "A" and "’" against the space, or with the next line's first character), the glyph takes the advance it shapes to alone. A line that fits only with that kerning breaks before the glyph, as Chromium breaks it, and a justified line spreads the slack its unkerned end leaves, in Latin text as in CJK.
