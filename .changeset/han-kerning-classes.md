---
'@ritojs/core': patch
---

Adjacent CJK punctuation trims by Chromium's punctuation classes for every bracket and quote: the CJK double prime quotes (`〝〞〟`) and any other fullwidth bracket trim like `「」`, a fullwidth opener after a narrow one (`(「`) and a fullwidth closer before a narrow one (`」)`) trim, the middle dots `·` and `‧` make their neighbours trim as `・` does, and each of these closers can trim at a line end.
