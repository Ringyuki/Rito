---
'@ritojs/core': patch
---

Changing the font, the font size or any other layout setting no longer opens the book again: a layout change is a new request on the reader's one session, so a change costs only the layout itself (about half the time it did on a large chapter, and a slider drag no longer reopens the book at every step). The engine also parses a publication's stylesheets once instead of once per chapter per layout, and its layout cache evicts in logarithmic time where a full cache scanned every entry on each insert. A reader session's font catalog and unresolved family names now cross from the worker as the same binary messages the C ABI uses.
