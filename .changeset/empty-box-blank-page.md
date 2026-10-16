---
'@ritojs/core': patch
---

An illustration sized to the page no longer leaves a blank page before it when it follows an element with no height, such as a `<div>` holding only an anchor. The empty element took no space but counted as content, so the illustration's line, a few pixels taller than the page, broke to the next page instead of overflowing on this one as it does in a browser. An element with no height now leaves the page empty, as in Chromium: its margins still take space, and a forced break after it still starts a new page.
