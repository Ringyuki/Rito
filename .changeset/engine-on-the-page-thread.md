---
'@ritojs/core': patch
'@ritojs/kit': patch
---

The reader's engine runs on the page's own thread instead of in a Worker, and a layout commit paints at once: the frame in which a window is resized draws the layout for its new size, where the Worker's answer reached the page a frame or more later and most sizes of a drag were never drawn. The whole book behind the page shown lays out a few pages per step, each after the page has had a turn. Opening a book, and the first search or text interaction that lays the rest of a chapter out, hold the page while they run. The package no longer ships a worker entry.
