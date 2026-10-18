---
'@ritojs/core': minor
---

`reader.renderSpreadTo` also paints into a WebGL2 framebuffer (`ReaderGlTarget`), the same pixels as into a 2D canvas: a page of text is drawn on the GPU from glyphs the canvas rasterized, any other page is painted on a canvas and copied in. `createReader` no longer takes the canvas's 2D context until `renderSpread` paints into it.
