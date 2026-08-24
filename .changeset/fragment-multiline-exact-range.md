---
'@ritojs/core': patch
---

A multi-line exact source range now resolves under the fragment engine. The
fragment backend reported the laid-out page text — line and page separators
included — as both the selected text and the source checksum, so any range
that crossed a soft-wrapped line failed its source verification and came back
`sourceUnavailable`. Selected text now reads continuously across soft wraps
inside one block (matching what a browser selection copies, with `\n` only at
block boundaries), and the checksum segments are split on those boundaries so
they verify against the source document.
