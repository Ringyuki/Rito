---
'@ritojs/kit': patch
---

While a window is being resized the controller reads the interaction targets of the spread shown once the size has stood still, instead of on every frame; until then a click on the spread finds none.
