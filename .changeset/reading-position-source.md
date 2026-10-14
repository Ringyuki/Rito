---
'@ritojs/kit': minor
'@ritojs/react': patch
---

`controller.position` is the reading position last published by `positionChange` (null until the first one resolves). `useReadingPosition` starts from it and follows the controller: a new book no longer shows the previous book's position until its first `positionChange`.
