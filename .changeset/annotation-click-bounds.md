---
'@ritojs/kit': minor
---

`annotationClick` carries `screenBounds`: the box around the clicked annotation's lines on the clicked page, in the same screen coordinates as `imageClick.screenBounds`. With only the `x`, `y` point a popover could not tell how tall the highlight is, so near the top of the page it had to drop below the point and covered the highlight's first line. `x`, `y` stay, the box's top centre.
