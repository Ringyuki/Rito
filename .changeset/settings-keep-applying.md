---
'@ritojs/core': patch
'@ritojs/kit': patch
'@ritojs/react': patch
---

The browser worker allows as many live artifacts as the engine (six; it was four), and the worker client holds a call made while it is busy instead of refusing it.
