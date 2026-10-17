---
'@ritojs/core': patch
---

An artifact no longer carries a SHA-256 of its display list. Nothing read it, and the engine hashed the display list of every spread it published, as for every size of a window being resized.
