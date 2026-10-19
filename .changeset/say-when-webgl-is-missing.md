---
'@ritojs/kit': minor
'@ritojs/react': patch
---

`canDrawWithWebGl2()` tells a host ahead of time whether the controller can draw in this browser, and `useRitoReader` reports `WebGlUnavailableError` before it opens the book instead of after laying it out.
