---
'@ritojs/kit': patch
---

While a window is being resized, the spreads beside the one shown are no longer painted ahead: each was painted for a size the next one replaced, and the reader asked for that next size only once the paint was done. They are painted once no size has come for 300 ms, when the whole-book layout is let go.
