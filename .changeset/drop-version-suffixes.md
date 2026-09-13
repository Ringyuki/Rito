---
'@ritojs/core': major
'@ritojs/kit': major
'@ritojs/react': major
---

Every `V1` suffix leaves the API. The repository never carried a second version of any of these types, and the one number that does move (the reader protocol version, now 5) proved the suffix meaningless. `openBrowserReaderV1` is `openBrowserReaderSession`, `createBrowserReaderV1CanvasPresenter` is `createBrowserReaderSessionCanvasPresenter`, `RitoReaderErrorV1` is `RitoReaderError`, and every `…V1` type on the public entry drops it. The reader session protocol's own modules and files carry `reader-session` where they carried `reader-v1`, so the session protocol and the revision worker no longer share a prefix. Only two places still name a version: the wire magic tags, whose trailing digit is the format number a decoder checks, and the numeric protocol and format version constants themselves.
