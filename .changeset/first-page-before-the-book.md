---
'@ritojs/core': patch
---

Opening a book shows its first page before laying the whole book out behind it: the reader starts the whole-book layout once the frame the first page is drawn in has passed, and the engine readies the book's chapters a chapter per page of each step's budget instead of reading, parsing and styling every chapter in one step. A book whose first page waited a whole-book step on the page's thread now shows it as soon as it is laid out.
