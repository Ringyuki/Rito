---
'@ritojs/core': patch
'@ritojs/kit': patch
---

A selection survives a relayout: when the book's layout follows the chapter's, or the reader is resized, retypeset or rescaled, the selection is found again by its source range and shown in the new layout, as a browser keeps a selection through a resize. While a selection is being made, the book's layout waits. The reader's text selection gains `resolveTextRangeFromSource()`, which resolves a source range as a range with both its carets, and a range resolved between two carets now comes back with them.
