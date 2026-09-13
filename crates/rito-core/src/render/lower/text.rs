//! Text runs: the inline box a run sits in — its background band and
//! border edges — and its decoration line lower to primitives around the
//! run, which then carries only what the renderer needs to raster glyphs.
//!
//! The band spans the run's decorated box: the extent the engine snapped
//! from the primary font's grid-fit ascent and descent (canvas
//! `fontBoundingBox`; a highlighted 20px title paints a 24px band, not its
//! em box) plus padding and border widths, or the em box when no metric
//! reached the engine. Every edge rounds to a whole CSS pixel like any
//! block, and a box split across lines squares the open end's corners and
//! carries no start or end edge there.
//!
//! The decoration line is the browser's: a rect from the run's start
//! across its advance, its top rounded to a whole pixel and its thickness
//! floored to at least one, the fractional ends left to antialias. One
//! inline box draws one line however many runs its text shapes into —
//! Chromium's underline under `act.1　奇幻篇①` (Latin, an ideographic
//! space, CJK) has no seam where the fonts change, while two fills that
//! abut at a fractional x composite to 79% on the shared pixel — so a
//! run continuing its box extends the line of the run before it.

use super::super::commands::{
    contract::{
        ReaderCluster, ReaderRect, ReaderRunBorderEdge, ReaderRunDecoration, ReaderSpacing,
        ReaderTextRun, ReaderTextRunPaint,
    },
    DisplayTextCommand,
};
use super::{block, DeviceRect, Ground, Primitive};

pub(super) fn lower_text(text: &DisplayTextCommand, out: &mut Vec<Primitive>) {
    if let Some(rect) = inline_box(text) {
        let paint = &text.paint;
        block::lower_inline_box(
            rect,
            paint.background_color,
            paint.background_radius,
            (paint.box_start, paint.box_end),
            paint.border.as_ref(),
            union(rect, (&text.rect).into()),
            out,
        );
    }
    let has_box = inline_box(text).is_some();
    out.push(Primitive::Text(text_run(text)));
    if let Some(decoration) = text.paint.decoration {
        let line = decoration_line(&text.rect, decoration);
        if !(has_box || text.paint.box_start) && extend_previous_line(out, &line) {
            return;
        }
        out.push(line);
    }
}

/// A run that continues its inline box (no start edge, no box of its own
/// painted in between) joins its decoration line to the one the run
/// before it drew, when that line sits on the same rows in the same
/// colour and ends where this one begins.
fn extend_previous_line(out: &mut [Primitive], line: &Primitive) -> bool {
    let Primitive::FillRect {
        rect: next,
        color: next_color,
        ..
    } = line
    else {
        return false;
    };
    // The run's own text primitive was pushed just before, and runs that
    // already joined the line pushed only theirs: the line is the first
    // primitive behind that string of text runs.
    let Some(index) = out
        .iter()
        .rposition(|primitive| !matches!(primitive, Primitive::Text(_)))
    else {
        return false;
    };
    let Some(Primitive::FillRect {
        rect,
        color,
        ground: Ground::None,
    }) = out.get_mut(index)
    else {
        return false;
    };
    let abuts = (rect.right() - next.x).abs() < 1.0 / 32.0;
    if !abuts || rect.y != next.y || rect.height != next.height || color != next_color {
        return false;
    }
    rect.width = next.right() - rect.x;
    true
}

/// An annotation paints only its glyphs.
pub(super) fn lower_ruby(text: &DisplayTextCommand, out: &mut Vec<Primitive>) {
    out.push(Primitive::Ruby(text_run(text)));
}

/// The run's border box in CSS pixels, when the run has a box to paint:
/// the engine's snapped extent above and below the run rect's top, or the
/// em box grown by padding and borders when no metric reached it, and the
/// run's advance grown by the padding and border widths of its closed
/// ends (an open end carries none).
fn inline_box(text: &DisplayTextCommand) -> Option<DeviceRect> {
    let paint = &text.paint;
    if paint.background_color.is_none() && paint.padding.is_none() && paint.border.is_none() {
        return None;
    }
    let padding = paint.padding.unwrap_or(ReaderSpacing {
        top: 0.0,
        right: 0.0,
        bottom: 0.0,
        left: 0.0,
    });
    let width = |edge: Option<ReaderRunBorderEdge>| edge.map_or(0.0, |edge| edge.width_px);
    let (border_top, border_bottom, border_start, border_end) =
        paint.border.map_or((0.0, 0.0, 0.0, 0.0), |border| {
            (
                width(border.top),
                width(border.bottom),
                width(border.start),
                width(border.end),
            )
        });
    let rect = &text.rect;
    let (top, bottom) = match paint.box_offsets {
        Some((top, bottom)) => (rect.y + top, rect.y + bottom),
        None => (
            rect.y - padding.top - border_top,
            rect.y + paint.font.size_px + padding.bottom + border_bottom,
        ),
    };
    let left = rect.x - padding.left - border_start;
    let right = rect.x + rect.width + padding.right + border_end;
    Some(DeviceRect::new(left, top, right - left, bottom - top))
}

/// The smallest rect holding both: the band's declared ground grows to
/// the run rect, whose em box can reach a fraction below a font's
/// integer descent (Tinos at 16px: descent row 3 against an em bottom of
/// 3.2), so the run's own ink is never judged to sit outside its band.
fn union(a: DeviceRect, b: DeviceRect) -> DeviceRect {
    let left = a.x.min(b.x);
    let top = a.y.min(b.y);
    let right = a.right().max(b.right());
    let bottom = a.bottom().max(b.bottom());
    DeviceRect::new(left, top, right - left, bottom - top)
}

fn decoration_line(rect: &ReaderRect, decoration: ReaderRunDecoration) -> Primitive {
    let thickness = decoration.thickness.floor().max(1.0);
    let top = (rect.y + decoration.y - decoration.thickness / 2.0).round();
    Primitive::FillRect {
        rect: DeviceRect::new(rect.x, top, rect.width, thickness),
        color: decoration.color,
        ground: Ground::None,
    }
}

fn text_run(text: &DisplayTextCommand) -> ReaderTextRun {
    let paint = &text.paint;
    ReaderTextRun {
        text: text.text.clone(),
        rect: text.rect,
        paint: ReaderTextRunPaint {
            font: paint.font.clone(),
            color: paint.color,
            text_shadows: paint.text_shadows.clone(),
        },
        line_height_px: text.line_height_px,
        href: text.href.clone(),
        source_text: text.source_text.clone(),
        source_text_offset: text.source_text_offset,
        clusters: text
            .clusters
            .iter()
            .map(|&(byte, x, y)| ReaderCluster { byte, x, y })
            .collect(),
    }
}
