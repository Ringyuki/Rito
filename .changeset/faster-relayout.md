---
'@ritojs/core': patch
---

Changing the font, the font size or any other layout setting no longer opens the book again: the session a retired layout leaves behind is kept and the next layout runs on it, catching up on the faces added or removed since, so a change costs only the layout itself (about half the time it did on a large chapter, and a slider drag no longer reopens the book at every step). The engine also parses a publication's stylesheets once instead of once per chapter per layout, and its layout cache evicts in logarithmic time where a full cache scanned every entry on each insert. A reader session's font catalog and unresolved family names now cross from the worker as the same binary messages the C ABI uses.
