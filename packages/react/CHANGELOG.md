# @ritojs/react

## 0.10.0

### Minor Changes

- 89e3441: Split core into a platform-neutral display-list API and a Web Canvas preset entry.

### Patch Changes

- 897cbfa: Fix float clearing to use CSS float margin boxes.
- e798c67: Refactor tag defaults into the UA cascade and fix none border layout
- 49ab16d: Fix forced-break line alignment and KP inline run merging.
- Updated dependencies [897cbfa]
- Updated dependencies [e798c67]
- Updated dependencies [49ab16d]
- Updated dependencies [89e3441]
  - @ritojs/core@0.10.0
  - @ritojs/kit@0.10.0

## 0.9.0

### Minor Changes

- 5313906: Add runtime line-breaking configuration so readers can switch between greedy and optimal pagination.

  Fix greedy line breaking so English hyphenation does not cross into adjacent CJK text, preventing mixed Latin/CJK runs from being split and over-justified.

  Fix Canvas text spacing reset and hit testing so mixed Latin/CJK text, brackets, and selections stay aligned after rendering letter- or word-spaced content.

### Patch Changes

- Updated dependencies [5313906]
  - @ritojs/core@0.9.0
  - @ritojs/kit@0.9.0

## 0.8.0

### Minor Changes

- 424acd3: Add Unicode-aware CJK and mixed-script line breaking with CSS line-break, word-break, text-justify, and inherited language support.

### Patch Changes

- 7e6844d: Fix custom-font title centering and honor body bgcolor page backgrounds during pagination.
- Updated dependencies [424acd3]
- Updated dependencies [7e6844d]
  - @ritojs/core@0.8.0
  - @ritojs/kit@0.8.0

## 0.7.3

### Patch Changes

- e37770a: Refactor layout, render, and reader internals to reduce lint complexity while preserving rendering output.
- Updated dependencies [e37770a]
  - @ritojs/core@0.7.3
  - @ritojs/kit@0.7.3

## 0.7.2

### Patch Changes

- 2796283: Fix search navigation state updates when jumping to a distant result. Far search jumps now emit spreadChange so reader state stays in sync after skipping animated navigation.
- Updated dependencies [2796283]
  - @ritojs/kit@0.7.2
  - @ritojs/core@0.7.2

## 0.7.1

### Patch Changes

- f4b520d: Fix controller render-scale initialization to avoid canvas resize flicker when reloading a book.
- Updated dependencies [f4b520d]
  - @ritojs/kit@0.7.1
  - @ritojs/core@0.7.1

## 0.7.0

### Minor Changes

- 570f326: Add per-property force flags and null-clear semantics to `setTypography`.
  - `lineHeightForce` / `fontFamilyForce`: when `true` and the corresponding value is set, the override is rewritten onto every element during pagination, bypassing element-level CSS (e.g. `p { line-height: 1.3em }`). When `false` (default), the override only cascades from body and element-level rules still win — preserves previous behavior.
  - Value fields (`fontSize`, `lineHeight`, `fontFamily`) now accept `null` to explicitly clear a previously-set override and fall back to the book's natural value. `undefined` continues to mean "no change".

  Existing callers that pass values or `undefined` continue to work unchanged.

### Patch Changes

- Updated dependencies [570f326]
  - @ritojs/core@0.7.0
  - @ritojs/kit@0.7.0

## 0.6.0

### Minor Changes

- Prepare the public release surface for the Rito packages.

  This release removes worker pagination from the core package, fixes controller and React lifecycle issues found during prepublish review, and adds package-level documentation plus release metadata for the public packages.

### Patch Changes

- Updated dependencies
  - @ritojs/core@0.6.0
  - @ritojs/kit@0.6.0
