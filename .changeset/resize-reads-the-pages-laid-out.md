---
'@ritojs/core': patch
---

While a host holds the book layout (`holdBookLayout`, as a window is being resized), a relayout reads only the part of the page table laid out for the spread shown, instead of having the rest of the chapter laid out for every size; once the hold is released the whole table is read and `onLayoutCommitted` reports it. Locating the reader's own position no longer lays the rest of the chapter out either.
