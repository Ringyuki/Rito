---
'@ritojs/core': patch
---

Margins collapsing through several plain wrappers join as one set, the largest positive plus the most negative, as CSS collapses adjoining margins: a negative margin deep in a chain of wrappers no longer cancels against only the nearest one, which left a title page's heading lower than in the browser.
