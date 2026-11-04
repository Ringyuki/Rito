---
'@ritojs/core': patch
---

Where WebGL is a software rasterizer (SwiftShader, llvmpipe — a machine with no GPU), the canvas pen paints every page and the GPU only copies it in, as it already did where the browser refused WebGL for a performance caveat: Chromium creates a context on SwiftShader all the same, and the GPU pen there blended text a level or two off the canvas.
