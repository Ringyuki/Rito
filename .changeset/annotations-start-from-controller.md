---
'@ritojs/react': patch
---

`useAnnotations` starts from the records the controller already holds: those its annotation storage loaded before the hook listened were told by no event, so a book opened again listed no annotations until the next change (a scrolled view, which draws them from that list, showed none).
