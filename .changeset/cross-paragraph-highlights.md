---
'@ritojs/core': patch
'@ritojs/kit': patch
---

A highlight spanning paragraphs draws in books whose chapter wraps its paragraphs in one element (a `<div>` around the text). `resolveExactSourceRange` answered `unavailable` (`sourceUnavailable`) for such a range: the paragraphs shared their wrapper's block, so their text ran together with nothing between them and no longer matched the source, where whitespace separates them. Each paragraph now counts as its own, and the text of a selection across them copies with the blank line between paragraphs a browser copies.

`@ritojs/kit` emits an `error` event (source `native-annotation-geometry`) when the engine cannot place an annotation's range, once for the layout, naming the chapter and the reason; the annotation used to vanish from the page without a word. A range still waiting for its page's layout is not reported.
