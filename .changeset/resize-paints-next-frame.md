---
'@ritojs/kit': patch
---

A layout commit paints the new size on the next animation frame instead of before it returns. The commit painted the resized canvas at once, so the reader asked the engine for the next size only after that paint: each size of a window being dragged cost the layout and the paint one after the other. The paint now waits for the animation frame, which the browser runs before it shows the resized canvas, so no frame shows it empty; the next layout runs while this one is painted, and layouts committed within one frame are painted once.
