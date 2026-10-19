---
'@ritojs/kit': patch
---

The display canvas's drawing buffer is as large as the screen and only grows: a window dragged through a new size every frame reallocated it, and made the page wait for the GPU, on every frame. The canvas shows the buffer's bottom-left corner, as large as its box at the screen's ratio, one buffer pixel per device pixel; `canvas.width` and `canvas.height` are the buffer's size, and a host that reads the display back draws that corner.
