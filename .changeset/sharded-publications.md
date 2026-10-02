---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
'@ritojs/core-wasm': minor
---

A publication can be opened from shards instead of a whole EPUB. `rito-pack` splits a book into a skeleton (every chapter, stylesheet, font and navigation file, the file table and every image's intrinsic dimensions) and one content shard per image, audio or video file, each deflated when that makes it smaller and optionally sealed with per-shard XChaCha20-Poly1305 keys. The whole book lays out from the skeleton alone (a median of 7% of the archive on the test corpus), so opening, page numbers, the table of contents, search and turning behave exactly as for the EPUB; only painting an image waits on its shard. `createReader` and `openBrowserReaderSession` accept a `ReaderShardedPublication` (`{ skeleton, key?, loadShards }`) wherever they accepted an `ArrayBuffer`: the engine names an image's shard the first time it is read, the client loads it through `loadShards`, hands it to the worker and retries the read. A reader that reopens in a fresh worker supplies the shards it already loaded without asking again. Engine errors gain the `resource-pending` code with `pendingShards`; a frame window whose image shard has not arrived fails as pending instead of reporting the image missing for good.
