---
'@ritojs/core': patch
---

The first page of a sharded book no longer keeps its broken-image placeholder when the image's shard arrives after the whole book is laid out. The page laid out alone and the same page under the whole-book layout shared one read of the image; the reader gave the old page back while that read waited for its shard, the read then failed for the page that was gone (`Reader artifact is not live in this worker`), and the page shown took that failure as its own. A page now reads the image through itself when the read it waited on failed only because its page was given back; a failure of the image itself is still shared.
