---
'@ritojs/core': major
'@ritojs/core-wasm': minor
---

`reader.getChapterTextIndices()` and the `ChapterTextIndex` / `ChapterTextSpan` types are removed. Nothing in Rito read them since annotation targets, TOC entries and position order moved into the engine, yet every revision commit shipped the whole book's text from the worker to build them. Durable source ranges come from `search()` results, selections and `createAnnotationTarget`. `@ritojs/core-wasm` drops `getChapterTextIndicesAtRevision`, `getChapterTextIndices`, `createRitoCoreWasmReaderChapterTextIndexMap`, the `chapterTextIndices` revision-bundle field and their types.
