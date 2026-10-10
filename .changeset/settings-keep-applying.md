---
'@ritojs/core': patch
'@ritojs/kit': patch
'@ritojs/react': patch
---

Settings changed in quick succession all take effect, and keep taking effect afterwards. Three things could leave a reader ignoring every later change of font size, family, line height or size: the engine treated a neighbouring spread loaded between a layout request and its adoption as a newer navigation and refused the adoption; the reader then kept the refused layout's artifact, which held one of the session's slots for good; and the browser worker still allowed four live artifacts where the engine has allowed six since spreads are loaded ahead, so a layout requested while the whole book of the previous one was arriving had no slot. A spread loaded ahead no longer disturbs a layout waiting to be adopted, the worker's limit is the engine's, a layout the session refuses is given back and asked for again, and the whole book is laid out for whichever layout ends up shown.
