---
'@ritojs/core': major
'@ritojs/kit': major
'@ritojs/react': major
'@ritojs/core-wasm': minor
---

`createReader()` opens a book on the reader session protocol, the one the Flutter adapter and the C ABI speak, and the revision runtime it used to run on is removed. A layout — at open and after every change that paginates again — is committed twice: the chapter being read first, laid out alone, so its page is on screen after one chapter's work, then the whole book under book-wide page numbers. `Reader.layoutScope` says which commit is current (`'chapter'` or `'book'`), `onLayoutCommitted` fires for both, and during the chapter commit `pageCount`, `totalSpreads`, `spreads`, `chapterMap` and every page index describe that chapter alone. `@ritojs/kit` keeps its page numbers, progress and navigation book-wide throughout: a turn inside the chapter is immediate, and a turn past its edge or a jump outside it waits for the book and lands there.

Measured in the demo reader on a production build (headless Chromium, 393×760@3x single page and 1280×860@2x double page, three books, medians): opening a book takes 215–280 ms where it took 540–750; a font-size or font-family change shows its page in 38–90 ms where it took 90–375, and in 170–210 ms where it took 360–670 on a book whose text is nearly all one chapter; page numbers follow the first page by 165–215 ms (320–350 ms on the one-chapter book); page counts are unchanged.

Breaking: `Reader.getFootnotes()` is removed — a session answers one note by its key, through `interactions.getFootnote(key)`. A caret from `interactions.textSelection` belongs to the commit that answered it, so a selection made between the chapter commit and the book commit is cleared by the second. `interactions.enabled` no longer turns false for a preview, because there is none. `@ritojs/core-wasm` ships the session runtime alone: the document wrapper, the revision worker and its client, and their types are gone.
