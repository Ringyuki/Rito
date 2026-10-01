---
'@ritojs/core': minor
'@ritojs/kit': major
'@ritojs/react': major
'@ritojs/core-wasm': minor
---

Annotation targets are built and read by the engine, so a highlight stored by one host resolves identically on every other. `AnnotationTarget` is now `{ version: 1, href, sourceRange, quote: { exact, prefix, suffix }, position: { start, end, chapterLength } }`, with offsets in UTF-16 units over the chapter's raw parsed text; the selector objects, `text` context and every Kit-side anchoring helper are removed, and targets in the earlier shape are not read. `ReaderController.addAnnotation()` (and `useAnnotations().add`) now returns a `Promise`: it reads the selection at call time and resolves once `interactions.createAnnotationTarget` has built the target, reporting a failed build on the `error` event (source `'annotation-target'`) instead of rejecting. Stored targets are located by `interactions.resolveAnnotationTarget` — the source range checked against its quote, then the best-context quote, then the stored offsets, then the length-scaled position — and `ResolutionStatus` names that level: `'exact' | 'quote' | 'position' | 'progression' | 'orphaned'`. `@ritojs/core` adds `ReaderAnnotationTarget`, `ReaderAnnotationTargetResolution` and the two interactions; `@ritojs/core-wasm` adds `createAnnotationTargetAtRevision` and `resolveAnnotationTargetAtRevision`.
