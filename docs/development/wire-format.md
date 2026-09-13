# Wire Format: `RITODL1` format 2

A frame reaches a host as one `RITODL1` byte buffer: the page's display
list lowered to device pixels at the host's render ratio. The host
decodes and blits; every raster decision was made in the engine.

The Rust encoder is the definition
(`crates/rito-core/src/render/commands/reader_wire/encode/`). Two
production decoders are kept in the same commit as the encoder: the
JavaScript one in `packages/rito-core-wasm/src/frame-command-buffer-decoder-runtime.js`
and the Dart one in `packages/rito_flutter/lib/src/protocol/primitive_decoder.dart`.
`packages/rito-core-wasm/tests/fixtures/reader-session-primitive-list.hex`
holds bytes the live encoder wrote for one of every primitive, and a
Rust test keeps it in step. There is no cross-version compatibility
guarantee: engine and decoder come from the same commit.

## Encodings

All integers and floats are little-endian.

| Value    | Encoding                                                         |
| -------- | ---------------------------------------------------------------- |
| u8 tag   | one byte                                                         |
| u16      | 2 bytes                                                          |
| u32      | 4 bytes (all counts and lengths)                                 |
| u64      | 8 bytes                                                          |
| f64      | 8 bytes, finite (the encoder refuses NaN and infinity)           |
| f32      | 4 bytes, finite                                                  |
| string   | u32 byte length, then UTF-8                                      |
| optional | presence byte (0 or 1), then the value when present              |
| point    | f64 x, f64 y                                                     |
| rect     | f64 x, f64 y, f64 width, f64 height                              |
| colour   | u8 space tag, 3 × f32 components, f32 alpha, u8 `none` flag bits |

Colour space tags: 1 srgb, 2 hsl, 3 hwb, 4 lab, 5 lch, 6 oklab, 7 oklch,
8 srgb-linear, 9 display-p3, 10 display-p3-linear, 11 a98-rgb,
12 prophoto-rgb, 13 rec2020, 14 xyz-d50, 15 xyz-d65. The engine emits
sRGB with 8-bit-quantized channels; the other tags are frozen so a
decoder rejects nothing the format allows. The `none` bits are
component 0, 1, 2 and alpha in bits 0..3.

## Header

```text
"RITODL1"        7 bytes magic
u32              format version, always 2
f64              render ratio: device pixels per CSS pixel
u32              primitive count
primitives...
```

Format 1 carried semantic commands and is no longer written; a decoder
rejects it by the version field.

## Primitives

Every primitive is a u16 opcode followed by its fields. Coordinates are
device pixels unless noted.

| Opcode | Primitive  | Fields                                                                         |
| -----: | ---------- | ------------------------------------------------------------------------------ |
|      1 | PushState  | none                                                                           |
|      2 | PopState   | none                                                                           |
|      3 | Translate  | f64 dx, f64 dy                                                                 |
|      4 | Opacity    | f64 value                                                                      |
|      5 | Transform  | point origin; u32 count; per transform a u8 tag and its fields                 |
|      6 | ClipPath   | path                                                                           |
|      7 | FillRect   | rect, colour, ground                                                           |
|      8 | FillPath   | path, u8 fill rule, colour, ground                                             |
|      9 | StrokePath | path, f64 width, colour, u8 cap, optional dash (f64 on, f64 off)               |
|     10 | Shadow     | path shape, f64 sigma, point offset, colour, optional path clip-out            |
|     11 | DrawImage  | string src, rect dest, optional rect source (image pixels), optional tile plan |
|     12 | Text       | text run body                                                                  |
|     13 | Ruby       | text run body                                                                  |

Transform tags: 1 rotate (f64 radians), 2 scale (f64 sx, f64 sy),
3 translate (f64 dx, f64 dy). Percentages were resolved in the engine.

Path: u32 op count, then per op a u8 tag and its fields — 1 move-to
(point), 2 line-to (point), 3 arc (point center, f64 rx, f64 ry, f64 start,
f64 sweep), 4 ellipse (point center, f64 rx, f64 ry), 5 rect (rect),
6 close.

Fill rule tags: 1 non-zero, 2 even-odd. Stroke cap tags: 1 butt, 2 round.

Ground: u8 tag 1 none, 2 page, 3 block followed by the block's rect. A
ground declares what a fill is the background of, so a pen that composites
in passes (or a diff instrument) can classify it.

Tile plan: point origin, f64 step x, f64 step y, u32 columns, u32 rows —
the image is drawn once per cell.

## Text run body

Text (12) and ruby (13) share one body. Its lengths are CSS pixels, not
device pixels: a host draws the run under `scale(ratio)` because glyph
rasterization follows the CSS font size.

```text
string   text
rect     rect (CSS pixels)
         run paint:
string     font family list, CSS syntax
f64        font size (CSS px)
f64        font weight
u8         font style tag: 1 normal, 2 italic
colour     colour
u32        text shadow count, then per shadow f64 offset x, f64 offset y, f64 blur, colour
optional f64     line height
optional string  link target (href)
optional string  source text
optional u64     source text offset
u32      cluster count, then per cluster u32 UTF-8 byte offset, f64 x, f64 y
```

A run carries glyph paint only. Its inline box (background band,
padding, border edges) and its decoration line arrive as fill and stroke
primitives around it, and letter spacing, word spacing and justification
are already in the cluster origins: a host draws each cluster at its
origin with its own spacing off and never places a glyph itself. A
cluster's y is the alphabetic baseline for a text run and for a ruby
annotation alike. Vertical columns arrive as runs of upright glyphs
stepped down the column, each rotated mark as its own run under a
quarter-turn transform primitive.

## Frame metadata

The buffer travels with metadata the host does not need to blit:
protocol version, ratio, primitive count, byte length, the semantic
display list's command count, kind counts and hash (an identity within
one engine build), the resource table (sorted image hrefs the frame
references), the font families it paints with, and whether the frame is
image-dominated.
