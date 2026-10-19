---
'@ritojs/core': patch
---

Decoding an artifact on the page reads every number through one view of its bytes; it made a view and a slice for each, which for a page of text cost as much as laying the page out.
