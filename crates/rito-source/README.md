# rito-source

`rito-source` owns Rito's platform-neutral, immutable XHTML source tree.
`SourceArena::from_xhtml` is the canonical parse boundary: a chapter is parsed
once, then the resulting tree provides stable `NodeId` values and read-only
navigation to semantic parsing, style-engine adapters, locators, and
interaction code.

It deliberately has no browser, JavaScript, canvas, layout, or style-engine
dependency. `SourceArena` does not implement `Clone`; production owners should
share one arena with `Arc<SourceArena>` so a `NodeId` always refers to one
canonical topology. Rito's production chapter preparation retains that `Arc`
beside its semantic `ParseResult` in `ParsedLoadedChapterSource`; the public
compatibility `rito_core::xhtml::parse_xhtml` result does not expose source
IDs because it does not return an arena. A style-engine adapter can consume
another clone of the prepared chapter's same `Arc` without reparsing XHTML or
owning a second source topology.

`SourceArena` is not a browser DOM. It has no `window`, `document`, HTML
element classes, events, mutation API, Web API, `web-sys`, or JavaScript
runtime. It is an ordinary Rust arena that can run in native, server, worker,
and DOM-free WASM environments. Stylo's upstream traits use DOM terminology,
but the Rito adapter implements those traits as a read-only view over this
arena and keeps Stylo's mutable computed-style data in a separate private
sidecar.

The parser accepts bounded internal DTD entities, repairs the legacy EPUB
forms already supported by Rito (`&nbsp;`, single-quoted XML declarations, and
unpaired HTML void elements), then applies strict XML validation. Nesting is
limited to 128 elements and parser nodes are limited to 1,000,000.
