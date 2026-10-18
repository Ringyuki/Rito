---
'@ritojs/core': patch
---

A display list's text runs index into tables after its primitives (`RITODL1` format 4): every run's clusters are views of one table read where the message holds it, the text of every run is decoded once, and each distinct paint is decoded once and shared by the runs that use it. A message leaves the engine with one copy and the display list is read inside the artifact instead of being copied out of it. Treat a decoded run's paint and clusters as read-only.
