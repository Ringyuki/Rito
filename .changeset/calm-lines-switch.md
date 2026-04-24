---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
---

Add runtime line-breaking configuration so readers can switch between greedy and optimal pagination.

Fix greedy line breaking so English hyphenation does not cross into adjacent CJK text, preventing mixed Latin/CJK runs from being split and over-justified.
