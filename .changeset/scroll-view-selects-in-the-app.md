---
'@ritojs/kit': patch
---

Text selection works in a scroll view a React host mounts through a ref: mounting the view again where it already is no longer lays the strip out again, which ended every drag and double press and, with each rest re-rendering the host, laid the strip out on every frame. While a selection is being made the whole-book layout waits, as it does for the page controller, so a layout landing mid-drag does not end the gesture.
