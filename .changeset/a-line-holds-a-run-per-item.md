---
'@ritojs/core': patch
---

A line's text in one inline item is one text run, as the browser keeps one text fragment per inline item on a line: the words, justification points and re-anchored ideographs it was placed in stay inside the run as the origins its clusters step from, so every pixel is the same. A page of Latin text carries about a tenth of the runs it did, in its display list and in its page targets. A caret, a selection edge or a hit inside a run lands on the cluster edges the run is drawn with instead of a proportional share of the run's width, and a double tap selects the word the browser selects: on the boundary before a word that word, and past the end of a line that wraps inside its paragraph the line's last word.
