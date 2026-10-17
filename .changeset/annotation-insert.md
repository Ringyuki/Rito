---
'@ritojs/kit': minor
'@ritojs/react': minor
---

`controller.insertAnnotation(record)` stores a whole annotation record as given (its id, colour, note and timestamps), so a host can undo removing an annotation or editing one. `addAnnotation` only made new records from the selection and the storage adapter was read once at start, so a removed highlight could not come back with its colour and note, and `updateAnnotation` cannot take a note away again. A record with a stored record's id replaces it where it stands; any other goes in creation order, which is paint order, so a removed record put back lies under and over the same neighbours. It is persisted like any change. `useAnnotations()` in `@ritojs/react` returns it as `insert`.
