---
'@ritojs/core': minor
'@ritojs/react': patch
---

A book whose `initialLocator` names no chapter it holds (a position saved against another edition, or written in a form the book does not use) opens at its start instead of failing to open, and `reader.initialLocatorMatch` is `'bookStart'`; otherwise it says which of the locator's selectors the book opened at (`ReaderLocatorMatchedBy`). Only the open falls back: `navigateToLocator` to such a locator still leaves the reader where it is. `useRitoScrollReader` opens the book on `initialLocator`'s chapter, so the line is in the first layout and the open reports the match.
