---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
'@ritojs/core-wasm': minor
---

`openBrowserReaderSession()` gains what a reader needs to be built on it. `navigation({ kind: 'layout', artifactId })` answers the page table of the revision behind an artifact — its spreads, the pages of each chapter and where the TOC entries land — and `peekSpread(fromArtifactId, spreadIndex)` publishes any spread of it at the cost of a peeked turn. A layout carries `lineHeightForce` and `fontFamilyForce`, which say whether those overrides outrank the publication's own declarations. An artifact's hit entries carry the engine's classification (`kind`: text, link, image, footnote or pending footnote), a link's `targetLocator` and its `destinationLabel`, so a host no longer infers a tap target from the fields an entry happens to have. `exactSourceRange` and `textInteraction` take `{ everyPage: true }` (`BrowserReaderGeometryOptions`) and then answer for every page of the revision a range covers, each in the display-list space of its own spread. `markFontFamiliesUnavailable(families)` has the engine lay out without publication faces the browser refused to decode, and `createBrowserReaderSessionCanvasPresenter(session, options)` takes `BrowserReaderCanvasPresenterOptions`: `fontRejected` to be told of such a face, `hostFont` to paint with faces the page registered itself. The artifact protocol is version 6.
