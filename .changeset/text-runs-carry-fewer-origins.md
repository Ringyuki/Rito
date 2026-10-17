---
'@ritojs/core': patch
---

A text run carries an origin only for the clusters a pen cannot reach from the one before it: a cluster the previous one's bare glyph advance reaches (no spacing, justification or kerning added, the same face, left to right) is drawn in the same string. A page of justified Latin text was drawn in one canvas call per character and is now drawn in one per stretch between justification points and kern pairs; every pixel is the same.
