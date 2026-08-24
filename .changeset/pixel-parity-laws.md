---
'@ritojs/core': patch
---

Pixel-parity fixes measured against pinned Chromium across the 123-book corpus:

- A childless inline box (an empty `<sup>` footnote anchor) joins its line's metrics with its
  font's integer envelope around the raised baseline, matching Blink's integer half-leading and
  `super` shift laws. A whole book of footnoted prose now renders at pixel zero.
- An inline flow holding nothing but empty anchors is an empty paragraph (CSS 2.1 §9.4.2), and
  an empty anchor settles a pending collapsed space into the previous text run — calibre books
  with mid-sentence `<a></a>` anchors no longer grow phantom lines or fuse words.
- The line-end punctuation trim measures a straddle-suppressed opener in its mid-line half-width
  form and un-suppresses the pair when the extension lands, matching Blink's shaping-domain
  order; quote-chain line breaks land where the browser breaks them.
