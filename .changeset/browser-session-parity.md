---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
'@ritojs/core-wasm': minor
---

`openBrowserReaderSession()` now carries the whole session protocol the Flutter adapter and the C ABI speak, not only page turns: `peekAdjacent` and `commitPeekedArtifact` preview a turn without touching the foreground, and `readFootnote`, `search`, `textRangeGeometry`, `exactSourceRange`, `textInteraction`, `annotation` and `navigation` answer with the same engine code and the same binary messages a native host reads. The JavaScript decoders are pinned to bytes the Rust encoder produces, and the browser binding is checked byte for byte against the Core session it wraps. New public types: `BrowserReaderFootnote`, `BrowserReaderSearchResponse`, `BrowserReaderTextPosition`, `BrowserReaderTextRangeGeometry`, `BrowserReaderSourceRange`, `BrowserReaderExactSourceRangeResolution`, `BrowserReaderTextInteractionQuery`, `BrowserReaderTextInteractionResponse`, `BrowserReaderAnnotationQuery`, `BrowserReaderAnnotationResponse`, `BrowserReaderNavigationQuery` and `BrowserReaderNavigationResult`.
