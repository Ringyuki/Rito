# Rust Parity Fixtures

These deterministic gzip-compressed JSON files are TypeScript-core reference
outputs for the Rust rewrite. They retain the complete diagnostic summaries
without committing hundreds of megabytes of pretty-printed JSON. They are not
public API fixtures and they do not define a reader session protocol.

The current fixture schema covers:

- EPUB package metadata, manifest, spine, and TOC summaries.
- Resource summaries for stylesheets, fonts, and images.
- Raw chapter XHTML source href/linear/text summaries.
- Parsed XHTML source-tree summaries, external/embedded stylesheet metadata,
  and structural detail hashes. Missing stylesheet metadata remains distinct
  from an explicitly empty list.
- Parsed stylesheet rule/font-face summaries, declaration value hashes, and
  structural detail hashes.
- Selector-match and cascade-order summaries for chapter-scoped author CSS rules
  against parsed XHTML element targets.
- Computed-style summaries, inline segment summaries, line-break inputs, greedy
  line boxes, continuous blocks, pagination/spread/display-list flow, hit-map
  flow, text-position flow, link-map flow, and search-flow hashes.

The committed matrix covers `book-01` through `book-10` for `smoke.greedy`,
`default.greedy`, `narrow.greedy`, and `default.optimal`.

Regenerate them with:

```sh
pnpm --filter @ritojs/core run fixtures:rust:export
```

Check that committed fixtures are current with:

```sh
pnpm --filter @ritojs/core run fixtures:rust:check
```

The check compares canonical JSON payloads after decompression. Regeneration
retains an existing gzip byte stream when that payload is unchanged, avoiding
noise from different Node/zlib compressor versions.
