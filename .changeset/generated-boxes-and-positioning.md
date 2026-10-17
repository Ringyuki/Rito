---
'@ritojs/core': minor
---

The engine lays out three more pieces of CSS that chat-style pages (avatars beside speech bubbles with pointed tails) are built from:

- A floated image that opens its block's content floats: the following lines and floats sit beside it, and its box is exactly the image. It used to stay an inline image on a line of its own. A floated image after text on its line still stays inline.
- `::before` and `::after` are generated: text in the element's lines, a block, a float or an absolutely positioned box, according to their `display`, `float` and `position`, showing their strings and `attr()` values. `counter()`, quotes and images in `content` show nothing.
- `position: absolute` takes a block-level box out of the flow and places it against its nearest positioned ancestor by its insets; it used to lay out in the flow. A speech bubble's tail, an empty `::before` drawn by one coloured and one transparent border, now paints where Chromium paints it.
