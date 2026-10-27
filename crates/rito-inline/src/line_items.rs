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
    // A box's start and end sizes are neither glyphs nor atoms: they only
    // move what follows them.
    placed
        .chain(split)
        .filter(|item| !matches!(item, LineItemView::Atom(inline_box) if inline_box.kind.is_tag()))
}

/// Whether the line holds an atomic inline (an image or an inline block).
pub(crate) fn line_has_atom(line: &Line<'_, [u8; 4]>) -> bool {
    line.style_runs().any(|item| {
        matches!(item, LineStyleRun::InlineBox(inline_box) if inline_box.kind == parley::InlineBoxKind::InFlow)
    })
}
