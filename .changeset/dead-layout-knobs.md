---
'@ritojs/core': major
'@ritojs/kit': major
'@ritojs/react': major
---

Layout options the engine never acted on are removed instead of being accepted silently: `ReaderOptions.lineBreaking` and `Reader.setLineBreaking()` (one line breaker exists; `'optimal'` always laid out as greedy), `ReaderOptions.paginationPolicy` and the `PaginationPolicy` type (widow/orphan control comes from the book's CSS), and `LayoutConfig.textMeasurement` (shaping is always font-aware). The browser host no longer measures Canvas glyph advances or re-paginates when those measurements change; the engine shapes with the pinned faces and the publication's `@font-face` fonts only, so every such re-pagination produced identical pages. `@ritojs/kit` and `@ritojs/react` drop the `setLineBreaking` action and its `lineBreaking` model field.
