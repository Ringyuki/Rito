---
'@ritojs/core': patch
---

An artifact carries its pages' index and size only: what a page holds for a host — its interaction targets, semantic outline, text and text runs — is built when the host first asks (`readPage`, one `RITOPGR1` message), the way a browser hit-tests the fragments it painted when a pointer arrives instead of keeping a table of them for every frame it draws. A window being resized no longer has the engine build, encode and the host decode every page's records for every size; the reader asks for a page's targets, outline and reading anchor through the same calls as before.
