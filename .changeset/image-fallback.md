---
'@ritojs/core': minor
'@ritojs/core-wasm': minor
---

An image that can no longer arrive paints a broken-picture placeholder instead of nothing: a block over the image box tinted 6% toward the text colour, with a picture icon split along a crack centred in it. The engine lowers the placeholder geometry with every inline image (`RITODL1` opcode 14, `image-fallback`, one loading and one broken variant) and both renderers paint the variant matching the image's state, tinted from the theme's page and text colours.
