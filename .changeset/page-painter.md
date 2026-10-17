---
'@ritojs/kit': minor
---

`paintPage` in `ControllerOptions` draws over each page as part of it, as `paintPage` does in `rito_flutter`: a page number drawn there moves with its page through every turn, a paper turn's leaf included, where a web host could only put one in its own chrome outside the page. It is called with a context clipped to the page in layout CSS pixels and the page's index, side, size and margins, with `bookPageIndex` and `bookPageCount` null while only the chapter being read is laid out. `controller.repaintPages()` paints every page again when what the painter draws changes. A painter that throws is reported on the `error` event (source `page-painter`) and leaves the page as the engine painted it.
