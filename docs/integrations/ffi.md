# Direct FFI integration

For hosts that are neither web nor Flutter (React Native, native apps,
game engines): bridge the engine through its C ABI directly.

## What you consume

- **`crates/rito-ffi`** — build it yourself from this repository
  (`cargo build --release -p rito-ffi` → `librito_ffi`). The crate is
  not published to crates.io and no prebuilt binaries are distributed;
  pin a commit of this repository and rebuild when you move it.
- **`crates/rito-ffi/include/rito_ffi.h`** — the ABI contract. Every
  function, status code, ownership rule, and the cost model live in its
  comments; treat it as the reference, not this page.
- **Wire messages** — requests and responses cross the ABI as
  length-framed binary messages (`RITOREQ1`, `RITOART1`, `RITODL1`,
  `RITONAV1`, …). If you hand-write a decoder, you own keeping it in
  lockstep with the engine commit you build (see below).

The engine, its wire encoding, and your decoder must always come from
the same commit. There is no cross-version wire compatibility
guarantee inside a major protocol version: fields are appended as the
paint domain grows, and a stale decoder misreads the byte stream.

## Non-negotiable contracts

- **Pinned font policy is required.** Chapter-local pagination shapes
  with pinned faces only — an open without a pinned font policy fails
  closed. This is what makes page N the same page on every platform.
- **One-pass cost model.** Opens, seeks, and cross-chapter turns build
  the whole target chapter in one call. There is no window pumping and
  no cooperative-retry loop; `RITO_STATUS_EXACT_SEEK_PENDING_V1` is
  never returned by the current core. A backward cross-chapter turn
  lands directly on the previous chapter's final page.
- **Open locators are treated as persisted data.** A saved source point
  or anchor that no longer resolves degrades to the locator's
  progression, then to the chapter start; `matchedBy` on the artifact
  reports what actually resolved. Only an unknown href fails an open.
- **Candidates are invisible until adopted.** Every foreground result
  is a candidate; commit it through
  `rito_adopt_foreground_candidate_v1` with the compare-and-swap
  expectation, exactly as the header describes.

## Keeping a hand-written decoder honest

The Dart decoder in `packages/rito_flutter/lib/src/protocol/` is the
reference implementation of the wire reader and is updated in the same
commit as any engine-side encoding change. When you bump your pinned
commit, diff that directory (and `render/commands/reader_wire_v1/` on
the Rust side) against your bridge.

Wire changes landed with the chapter-local one-pass cutover
(rito_flutter 0.2.0 era) that a hand-written decoder must mirror:

- `paintBlock.background.size` gained tag 4 (explicit axes): the tag
  byte is followed by two optional lengths (presence byte, then unit
  tag + f64 each); a missing axis is `auto`.
- Run paints gained a tail: one optional pair of f64 inline-box
  offsets (top, bottom — relative to the run rect top), then two bool
  bytes (`boxStart`, `boxEnd`).
- Border edges inside `paintBlock.border` carry a `width` field in the
  legacy JSON form; the V1 typed wire still transports widths in
  `borderBox`.
