//! A line's glyph runs and inline boxes as the line loop reads them:
//! positioned when the line carries its text, and otherwise only split by
//! style, which reads no glyph (see `parley::Line::style_runs`). Both split
//! and order a line alike.

use parley::{GlyphRun, Line, LineStyleRun, PositionedInlineBox, PositionedLayoutItem, Run};

pub(crate) enum LineItemView<'a> {
    Glyphs {
        run: Run<'a, [u8; 4]>,
        brush: [u8; 4],
        /// The glyph run with its glyphs placed, when the line carries its
        /// text.
        positioned: Option<GlyphRun<'a, [u8; 4]>>,
    },
    /// An inline box. Unless the line carries its text, its inline offset
    /// is not laid out and reads 0.
    Atom(PositionedInlineBox),
}

pub(crate) fn line_items<'a>(
    line: &Line<'a, [u8; 4]>,
    positioned: bool,
) -> impl Iterator<Item = LineItemView<'a>> + 'a {
    let baseline = line.metrics().baseline;
    let placed = positioned
        .then(|| line.items())
        .into_iter()
        .flatten()
        .map(|item| match item {
            PositionedLayoutItem::GlyphRun(glyph_run) => LineItemView::Glyphs {
                run: *glyph_run.run(),
                brush: glyph_run.style().brush,
                positioned: Some(glyph_run),
            },
            PositionedLayoutItem::InlineBox(inline_box) => LineItemView::Atom(inline_box),
        });
    let split = (!positioned)
        .then(|| line.style_runs())
        .into_iter()
        .flatten()
        .map(move |item| match item {
            LineStyleRun::Glyphs { run, style } => LineItemView::Glyphs {
                run,
                brush: style.brush,
                positioned: None,
            },
            LineStyleRun::InlineBox(inline_box) => LineItemView::Atom(PositionedInlineBox {
                x: 0.0,
                y: baseline - inline_box.height,
                width: inline_box.width,
                height: inline_box.height,
                id: inline_box.id,
                kind: inline_box.kind,
            }),
        });
    placed.chain(split)
}

/// The inline item each glyph run and inline box of a line belongs to, in
/// line order: a glyph run by its brush, an inline box by `u32::MAX - id`.
pub(crate) fn line_item_keys<'a>(line: &Line<'a, [u8; 4]>) -> impl Iterator<Item = u32> + 'a {
    line.style_runs().map(|item| match item {
        LineStyleRun::Glyphs { style, .. } => u32::from_le_bytes(style.brush),
        LineStyleRun::InlineBox(inline_box) => u32::MAX - inline_box.id as u32,
    })
}
