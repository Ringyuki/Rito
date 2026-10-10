---
'@ritojs/core': patch
'@ritojs/kit': patch
'@ritojs/react': patch
---

Settings changed in quick succession all take effect, and keep taking effect afterwards. A reader could end up ignoring every later change of font size, family, line height or size: it worked on its session's artifacts from three concurrent chains, so a neighbouring spread could be loaded between a layout request and its adoption, which the engine took for a newer navigation and refused; the refused layout's artifact was then kept and held one of the session's slots for good; and the browser worker still allowed four live artifacts where the engine has allowed six since spreads are loaded ahead. The reader now does everything that creates, adopts, commits or releases an artifact through one queue, one operation at a time — what it was asked for before a spread loaded ahead, the whole book when nothing waits — and one module owns every artifact, releasing whatever is not adopted before its operation ends. The engine no longer takes a spread loaded ahead for a navigation, the worker's limit is the engine's, and the worker client holds a call made while it is busy instead of refusing it.
