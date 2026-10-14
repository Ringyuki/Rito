---
'@ritojs/core': major
'@ritojs/kit': major
'@ritojs/react': major
---

`@ritojs/core` exports the reader and nothing of the session under it. `openBrowserReaderSession()`, `createBrowserReaderSessionCanvasPresenter()`, `RitoReaderError`, `BrowserReaderImageResourceError` and its code, `BrowserReaderCanvasUnsupportedError` and every `BrowserReader*` type are removed from the package's entry. A host built on the raw session had to run its artifact operations one at a time and release every candidate it did not adopt; `createReader()` does both, and is now the browser's one host of the session. An error a reader rejects with still carries the session's `code`.
