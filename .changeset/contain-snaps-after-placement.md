---
'@ritojs/core': patch
---

An image letterboxed by `object-fit: contain` is placed in its unsnapped box and the placed rect snaps to whole pixels, as Chromium snaps it: a thin rule image scaled into a fractional box now rasters on the one row the browser draws it on instead of smearing across two. A raster placed under a pixel tall or wide keeps one pixel where its start rounds, as the browser keeps it, instead of reaching the hosts as an empty image they reject; only one thinner than four LayoutUnits paints nothing.
