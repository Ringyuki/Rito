---
'@ritojs/core': patch
'@ritojs/kit': patch
'@ritojs/react': patch
---

A reader keeps a bounded log of what it asked its session and what it was answered — each request with its duration and outcome, each layout commit, each warning, and a request still unanswered shown as pending — so a report of something going wrong can carry it. `__ritoReaderDiagnostics.log()` returns it; bytes and long lists are shortened to their sizes and strings to 96 characters, so an entry can carry up to that much of a footnote, a selected range, an annotation's quote or a search query.
