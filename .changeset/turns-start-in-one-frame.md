---
'@ritojs/core': patch
'@ritojs/kit': patch
'@ritojs/react': patch
---

A page turn's first frame only composites. A page buffer is now rastered when it is painted (a canvas records its drawing calls and rasters them when first read as an image, which used to be the turn's first frame), a neighbouring spread is painted into its buffer when its content arrives instead of only once after the previous turn, and the accessibility mirror is rebuilt once the reader is at rest on a spread — after the frame that shows it and after a turn onto it has ended — instead of laying out two pages of text in front of that frame. On a 1280×860@2x double page the first frame of a turn follows the key by 19–25 ms where it took 29–34. A key a widget on the page has already handled (a slider stepping on an arrow key) is no longer taken as a reader shortcut, and search results are found again in a layout that replaces the one they were found in.
