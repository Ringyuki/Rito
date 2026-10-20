---
'@ritojs/core': patch
---

Readers opened together share one instance of the engine: two instantiated at once could each replace the module the other's session called into.
