---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
---

A publication can be opened from shards instead of a whole EPUB. `rito-pack` splits a book into a skeleton (every chapter, stylesheet, font and navigation file, the file table and every image's intrinsic dimensions) and one content shard per image, audio or video file, each deflated when that makes it smaller and optionally sealed with per-shard XChaCha20-Poly1305 keys. The whole book lays out from the skeleton alone (a median of 7% of the archive on the test corpus), so opening, page numbers, the table of contents, search and turning behave exactly as for the EPUB; only painting an image waits on its shard. `createReader` and React's `load` accept a `ReaderShardedPublication` (`{ skeleton, key?, loadShards }`) wherever they accepted an `ArrayBuffer`: the engine names an image's shard the first time it is read, the client loads it through `loadShards`, hands it to the worker and retries the read. While the reader is idle, the client also supplies image shards ahead of need, nearest the chapter being read first, one at a time and only while no other call is in flight. Engine errors gain the `resource-pending` code with `pendingShards`; a page is prepared without waiting for its images, so it paints at once, and an image whose shard has not arrived is read, and repainted, as soon as the shard is in.
