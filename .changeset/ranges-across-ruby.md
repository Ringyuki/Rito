---
'@ritojs/core': patch
---

A range across ruby text resolves: a selection or annotation that runs over a ruby base is drawn instead of failing with `sourceUnavailable`, since the source's annotation text is no longer required on the line, and a caret or range inside a ruby base lands on the base's own text. A search match across elements — a ruby base, a word in `<em>` — anchors the whole match instead of its longest stretch inside one element.
