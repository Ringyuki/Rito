---
'@ritojs/kit': minor
---

The paper turn no longer compiles its shaders in the first frame of the first turn, where it held the page still for most of a second the first time: an effect may have a `prepare()`, called when it is set, and the paper turn hands the GPU its programs there without waiting; a turn begun before they are compiled is drawn as `cover` to its end. On displays of two device pixels or more to a CSS pixel its canvas is not multisampled, which took a third of every frame, and a leaf's edge is softened in the shader.
