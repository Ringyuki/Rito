---
'@ritojs/core': major
'@ritojs/kit': major
'@ritojs/react': major
---

Every revision is complete the moment it is created, and the public types now say only that: a revision summary is `{ revisionId, revisionVersion, layoutKey, pageCount, spreadCount }` (a chapter-local one `coordinate`, `localPageCount`, `localSpreadCount`) with no `status`, `knownExtent` or `finalExtent`; `createBoundedRevision` returns that summary and `createBoundedChapterLocalRevision` returns `{ revision, target }` in a mutation result keyed `created`. Reader protocol v1 moves to version 5: `BrowserReaderArtifactV1` drops `terminalExtent` (every whole-book artifact carries `bookPageIndex` and `bookPageCount`), adjacent availability is `'available' | 'chapter-boundary' | 'terminal'`, the search response drops `scopeComplete`, and a `complete` background advance carries no artifact because the first publication candidate already carries the book page count. Hosts decoding the wire by hand must move their version gate to 5.
