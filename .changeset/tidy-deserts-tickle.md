---
'@ritojs/kit': patch
'@ritojs/react': patch
'@ritojs/core': patch
---

Fix search navigation state updates when jumping to a distant result. Far search jumps now emit spreadChange so reader state stays in sync after skipping animated navigation.
