---
'@ritojs/core': patch
---

Parse EPUB chapters whose XHTML is invalid in strict XML. The source normalizer
now escapes stray ampersands (e.g. `Schmidt & Bender`), remaps HTML named
entities undefined without a DTD (`&copy;`, `&mdash;`, `&nbsp;`, …) to numeric
references, and strips characters illegal in XML (C0 controls, `U+FFFE/FFFF`,
lone surrogates, and numeric refs pointing to them), while leaving comments and
CDATA sections untouched. Chapters that previously failed with errors such as
`EntityRef: expecting ';'` or `PCDATA invalid Char value 31` now parse.
