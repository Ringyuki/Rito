---
'@ritojs/core': patch
'@ritojs/core-wasm': minor
---

`Reader.findActiveTocEntry` and the TOC targets behind `findPage`/`resolveTocEntry` now come from the engine's source-locator resolution, so an entry whose fragment repeats an id from an earlier chapter, points at an inline element or at an empty `<a id/>` marker is placed where following it lands instead of being dropped; previously such entries never highlighted. The engine also decides each page's active entry itself (the last entry, in TOC order, whose target is at or before the page) and the browser binding only looks it up. `RitoCoreWasmTocTargets` gains `activeEntryByPage` and each `RitoCoreWasmTocTarget` a `tocIndex` (its preorder index in the TOC tree). Resolving a locator no longer builds a chapter's page artifacts unless the selector needs source positions, which takes TOC placement on a 730-page book from about 850 ms to under 3 ms.
