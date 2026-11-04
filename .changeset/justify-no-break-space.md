---
'@ritojs/core': patch
---

A justified line spreads the gap after a no-break space with the other word gaps, as Chromium treats the no-break space as a space when it justifies (a numbered item such as "2. Particular care…" with a no-break space after its number no longer keeps that gap narrow), and a no-break space ending a justified line counts as content instead of hanging.
