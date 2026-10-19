---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
---

A page's margins can be set side by side: `ReaderMargin` is one number, `{ x, y }` or `{ top, right, bottom, left }`, and `createReader`'s `margin`, `reader.updateLayout`, `controller.resize` and `useReaderAutoResize`'s `margin` take it. `useReaderAutoResize` now lays the book out again when only one side changes.
