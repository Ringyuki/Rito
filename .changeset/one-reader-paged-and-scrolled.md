---
'@ritojs/kit': minor
'@ritojs/react': minor
---

A book read in pages and scrolled is one reader: switching between them lays the open book out again instead of opening it a second time. The page controller's `suspend()` hands its reader to another view (its canvas off the page, its page buffers let go, no painting, turns, keys or layouts answered, while its annotations, search and stored position stay and its layout calls still lay the reader out), `resume()` takes it back as laid out then, and `suspended` says which. `useRitoScrollView(controller, { active, paged, scroll })` in `@ritojs/react` runs the switch: the reader laid out scrolled and shown from where the pages were, then paged again from where the view was read. A scroll view has its windows as soon as it is made, so it can be moved before it is mounted, and through every new layout it stays on the window the reader reads, which a chapter laid out alone and the whole book number differently (switching to scrolled used to land at the book's start once the whole book was laid out).
