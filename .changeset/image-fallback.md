---
'@ritojs/core': minor
---

An image that can no longer arrive paints a broken-picture placeholder instead of nothing: a block over the image box tinted 6% toward the text colour, with a picture icon split along a crack centred in it. The engine lowers the placeholder geometry with every inline image (`RITODL1` opcode 14, `image-fallback`, one loading and one broken variant) and both renderers paint the variant matching the image's state, tinted from the theme's page and text colours. In the browser reader an image that is still on its way shows nothing for its first second, then the loading placeholder; one that arrives after that fades in over it in 150ms. An image whose shard the host could not load shows the broken placeholder and is read again when its page is shown again, and while it stays shown after 2s, 5s and then every 15s; an image the publication cannot serve stays broken.
