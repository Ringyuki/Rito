---
'@ritojs/react': major
---

`useRitoReader().error` now only says why a book could not be opened. The controller's `error` events are non-fatal — the book stays open (a `font-family` choice no face answers to, a failed search or annotation write) — and no longer land in `error`, where a host showing it as a failure screen would hide a readable book; subscribe to them with `useControllerEvent(controller, 'error', …)`.
