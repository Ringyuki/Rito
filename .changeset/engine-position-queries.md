---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
'@ritojs/core-wasm': minor
---

`reader.interactions.tocEntryAtPosition({ href, point })` names the TOC entry a source position reads under (the last entry, in TOC order, whose target is at or before it, decided on the source alone — for a stored highlight's or bookmark's chapter), and `reader.interactions.compareSourcePositions(first, second)` orders two source positions in reading order (`-1`, `0` or `1`). Both are the engine functions a native host calls through `rito_resolve_navigation`, so every host answers alike. `ReaderSourcePosition` joins the public types; `@ritojs/core-wasm` adds `resolvePositionQueryAtRevision`.
