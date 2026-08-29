---
'@ritojs/core': patch
---

Backward cross-chapter page turns land in one call: chapter-local pagination now builds the whole target chapter through the fragment engine in a single pass (no page-cap windows or pending-seek retries), shares the whole-book footnote index and image dimensions so background candidates always match the visible pages, and an open locator that no longer resolves degrades sourcePoint → progression → chapter start instead of refusing the book.
