---
'@ritojs/kit': patch
---

The reading canvas no longer shows the browser's focus ring after a key press. The controller makes the canvas focusable so it receives keys, and now also sets its inline `outline-style` to `none`; disposing the controller gives the canvas back the `tabindex` and `outline-style` it had. A host that wants a ring sets the canvas's inline `outline` after creating the controller.
