---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
'@ritojs/core-wasm': minor
---

A publication can be opened from shards instead of a whole EPUB. `rito-pack` splits a book into a skeleton (what opening reads, the file table and each chapter's footnote scan) and content shards (one per chapter with the images only it uses, one per shared file), each deflated when that makes it smaller and optionally sealed with per-shard XChaCha20-Poly1305 keys, so a book's shards together weigh what the EPUB does. `createReader` and `openBrowserReaderSession` accept a `ReaderShardedPublication` (`{ skeleton, key?, loadShards }`) wherever they accepted an `ArrayBuffer`: the engine names each shard the first time a call needs it, the client loads it through `loadShards`, hands it to the worker and retries the call. A reader that reopens in a fresh worker supplies the shards it already loaded without asking again. Engine errors gain the `resource-pending` code with `pendingShards`; a frame window whose image shard has not arrived now fails as pending instead of reporting the image missing for good.
