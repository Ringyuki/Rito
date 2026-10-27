---
'@ritojs/core': minor
'@ritojs/kit': minor
---

A vertical-rl page's targets, outline, range rectangles and carets are where its columns are drawn, in the same page-content space as a horizontal page's, paged or scrolled; a scrolled window's records move with its pixels by the device rows it is drawn from. A caret's `geometry` gains `width`: it is the segment across its line, `width` 0 on a horizontal line and `height` 0 down a vertical one, and the kit projects it with that shape. `ReaderTextCaret.writingMode` (`ReaderWritingMode`) is the mode of the caret's line, and the kit's keyboard selection reads an arrow key on a `vertical-rl` focus as the key a quarter turn from it, as the browser does (down moves along the line, left to the next line).
