---
'@ritojs/kit': major
---

The controller draws with WebGL2 on its canvas: the pages it keeps are textures painted by `reader.renderSpreadTo`, every frame and the paper turn are drawn on the GPU, and a painted effect's scene is the display's WebGL2 context (`scene.gl`, `scene.page(slot).texture`, `prepare(gl)`) instead of a 2D context; `createController` throws `WebGlUnavailableError` where there is no WebGL2. See docs/migration/v4.md.
