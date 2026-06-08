---
'@ritojs/core': patch
---

Resolve in-content illustrations that previously rendered as broken images.
`loadEpub` now indexes every image file present in the archive — not only those
declared in the OPF manifest — so spec-violating books that reference undeclared
illustrations still get image data. Manifest resource reads are individually
tolerant (a single missing/mislabeled entry is skipped with a warning instead of
aborting the load), and href resolution percent-decodes on miss so references
like `Images/My%20Pic.jpg` match a literal `Images/My Pic.jpg` entry.
