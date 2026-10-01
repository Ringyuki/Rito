---
'@ritojs/core': minor
'@ritojs/core-wasm': minor
---

The engine derives `line-height: normal` geometry from the fonts it shapes with, the way Blink derives it — whole-pixel ascent, descent and line gap per font, ruby annotations stacked on normalized em heights, super/sub spans on their LayoutUnit shift — so every host lays out the same lines. The browser reader no longer measures metrics with the DOM, injects them or reflows to converge on them: a book paginates once. A character no registered face covers keeps the advance shaping gives it instead of a measured system-fallback width. `@ritojs/core-wasm` drops `takeHostLineMetricRequests`, `setHostLineMetrics` and their types, and the reader diagnostics hook drops `hostLineMetrics` and `unmetHostLineMetricRequests` (`hostLineMetricsEpochs` becomes `fontAvailabilityEpochs`).
