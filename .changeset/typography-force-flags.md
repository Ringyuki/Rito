---
'@ritojs/core': minor
'@ritojs/kit': minor
'@ritojs/react': minor
---

Add per-property force flags and null-clear semantics to `setTypography`.

- `lineHeightForce` / `fontFamilyForce`: when `true` and the corresponding value is set, the override is rewritten onto every element during pagination, bypassing element-level CSS (e.g. `p { line-height: 1.3em }`). When `false` (default), the override only cascades from body and element-level rules still win — preserves previous behavior.
- Value fields (`fontSize`, `lineHeight`, `fontFamily`) now accept `null` to explicitly clear a previously-set override and fall back to the book's natural value. `undefined` continues to mean "no change".

Existing callers that pass values or `undefined` continue to work unchanged.
