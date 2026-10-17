---
'@ritojs/core': patch
---

Resizing shows new sizes during the drag when the chapter being read takes longer than a frame to lay out. A layout under way was thrown away whenever a newer size came, so a host sending a size every frame saw the reader keep its old size until the sizes stopped: on a 51-page chapter whose layout takes about 30 ms, a drag of 30 frames laid out 16 sizes, committed none of them and showed only the last size after the drag. The layout under way now commits, and of the sizes that came meanwhile only the newest is laid out next, as `rito_flutter` does: on that chapter the canvas took a new size about every other frame of the drag (14 times in 30 frames). A chapter that lays out within a frame still shows every size, as 3.2.0 said (56 layouts a second for 56 sizes). The reading position stays where it was: each layout keeps the position the reader was asked to keep, not the first character of the page shown in between.
