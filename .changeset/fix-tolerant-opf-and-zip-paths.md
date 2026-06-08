---
'@ritojs/core': patch
---

Open spec-violating EPUBs that earlier failed to load. The OPF parser now
defaults missing `dc:title` / `dc:language` / `dc:identifier` to an empty string
with a warning instead of throwing (the structural `<manifest>` / `<spine>`
checks stay strict), and the ZIP reader percent-decodes container paths on a
lookup miss, so a manifest href like `Text/Character%20Profile.xhtml` resolves
to the literal `Text/Character Profile.xhtml` archive entry.
