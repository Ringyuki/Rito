//! The typed run paint built from one inline item's computed style: the
//! fill colour, background band and radius, text shadows, font family
//! stack and slant, word and letter spacing (justification shares ride the
//! same letter-spacing value), the single decoration stroke's offset and
//! thickness, and the inline box padding and border edges, gated on
//! whether the run opens or closes its box.

use rito_style_contract::{FontSlant, InlineFormattingStyle, LengthPercentage};

use crate::epub::EpubResult;
use crate::render::contract::{
    ReaderBorderEdgePaint, ReaderBorderStyle, ReaderFontPaint, ReaderFontStyle, ReaderRunBorder,
    ReaderRunBorderEdge, ReaderRunDecoration, ReaderRunDecorationKind, ReaderRunPaint,
    ReaderSpacing, ReaderTextShadow,
};
use crate::render::RunPaint;

use super::family::{css_color, paint_family_stack};
use super::{PaintFamilyPolicy, CANVAS_TOP_ASCENT_RATIO};

/// Builds the typed run paint the renderer consumes from one item's inline
/// style. Paint the command protocol cannot express is approximated —
/// unexpressible effects (transforms, box shadows, background images,
/// partial opacity) drop while the ink itself always paints.
pub(super) fn run_paint(
    style: &InlineFormattingStyle,
    family_policy: Option<&PaintFamilyPolicy>,
    justify_px: f64,
    box_start: bool,
    box_end: bool,
) -> EpubResult<RunPaint> {
    let paint = &style.paint;
    let color = css_color(paint.foreground)?;
    let background = paint.background.resolve(paint.foreground);
    let background_color = if background.alpha().get() == 0.0 {
        None
    } else {
        Some(css_color(background)?)
    };
    let font_size = f64::from(style.font.size.get());
    let text_shadows = paint
        .text_shadows
        .iter()
        .map(|shadow| {
            Ok(ReaderTextShadow {
                offset_x: f64::from(shadow.offset_x.get()),
                offset_y: f64::from(shadow.offset_y.get()),
                blur: f64::from(shadow.blur_radius.get()),
                color: css_color(shadow.color.resolve(paint.foreground))?,
            })
        })
        .collect::<EpubResult<Vec<_>>>()?;
    Ok(RunPaint::new(ReaderRunPaint {
        font: ReaderFontPaint {
            family: paint_family_stack(style, family_policy)?,
            size_px: font_size,
            weight: f64::from(style.font.weight.get()),
            // The wire expresses upright and slanted only; oblique paints
            // as italic, exactly as the canvas font string would coerce
            // it.
            style: match style.font.slant {
                FontSlant::Normal => ReaderFontStyle::Normal,
                FontSlant::Italic | FontSlant::Oblique(_) => ReaderFontStyle::Italic,
            },
        },
        color,
        word_spacing_px: spacing_px(style.text_flow.word_spacing)?,
        // Justification spacing rides the same painter knob as author
        // letter-spacing: the canvas spreads clusters exactly like the
        // DOM's justified shaping does (measured bit-identical).
        letter_spacing_px: match (spacing_px(style.text_flow.letter_spacing)?, justify_px) {
            (author, 0.0) => author,
            (author, justify) => Some(author.unwrap_or(0.0) + justify),
        },
        background_color,
        // One uniform radius slot, first-shorthand-component convention
        // (same contract as the block materializer): the pen's overlap
        // scale clamps an oversized value to the inline box, so b60's
        // border-radius:50px badge rounds to the circle Blink draws
        // instead of the square the hardcoded None left behind.
        background_radius: match style.fragment.border_radii.top_left.horizontal.value() {
            rito_style_contract::LengthPercentage::Length(value) if value.get() > 0.0 => {
                Some(f64::from(value.get()))
            }
            _ => None,
        },
        text_shadows,
        decoration: run_decoration(style, font_size)?,
        padding: run_box_padding(style, box_start, box_end),
        border: run_box_border(style, box_start, box_end)?,
        box_offsets: None,
        box_start,
        box_end,
    }))
}

/// Inline box padding for a run's paint, when any side is a positive
/// length. The painter grows the inline box outward from the run rect by
/// these values; percentages have no inline expression and drop to zero.
fn run_box_padding(
    style: &InlineFormattingStyle,
    box_start: bool,
    box_end: bool,
) -> Option<ReaderSpacing> {
    let side = |value: &rito_style_contract::NonNegativeLengthPercentage| match value.value() {
        LengthPercentage::Length(px) => f64::from(px.get()),
        _ => 0.0,
    };
    let padding = &style.fragment.padding;
    let spacing = ReaderSpacing {
        top: side(&padding.top),
        right: if box_end { side(&padding.right) } else { 0.0 },
        bottom: side(&padding.bottom),
        left: if box_start { side(&padding.left) } else { 0.0 },
    };
    (spacing.top > 0.0 || spacing.right > 0.0 || spacing.bottom > 0.0 || spacing.left > 0.0)
        .then_some(spacing)
}

/// Inline box border edges for a run's paint. Exotic stroke patterns
/// paint solid, exactly as block borders degrade.
fn run_box_border(
    style: &InlineFormattingStyle,
    box_start: bool,
    box_end: bool,
) -> EpubResult<Option<ReaderRunBorder>> {
    use rito_style_contract::BorderStyle;
    let edge = |edge: &rito_style_contract::BorderEdge| -> EpubResult<Option<ReaderRunBorderEdge>> {
        let width = f64::from(edge.resolved_width.get());
        if width <= 0.0 || matches!(edge.style, BorderStyle::None | BorderStyle::Hidden) {
            return Ok(None);
        }
        let line = match edge.style {
            BorderStyle::Dotted => ReaderBorderStyle::Dotted,
            BorderStyle::Dashed => ReaderBorderStyle::Dashed,
            _ => ReaderBorderStyle::Solid,
        };
        Ok(Some(ReaderRunBorderEdge {
            width_px: width,
            paint: ReaderBorderEdgePaint {
                color: css_color(edge.color.resolve(style.paint.foreground))?,
                style: line,
            },
        }))
    };
    let border = &style.fragment.border;
    let run = ReaderRunBorder {
        top: edge(&border.top)?,
        bottom: edge(&border.bottom)?,
        start: if box_start { edge(&border.left)? } else { None },
        end: if box_end { edge(&border.right)? } else { None },
    };
    Ok(
        (run.top.is_some() || run.bottom.is_some() || run.start.is_some() || run.end.is_some())
            .then_some(run),
    )
}

/// Maps computed text-decoration onto the protocol's single solid stroke.
fn run_decoration(
    style: &InlineFormattingStyle,
    font_size: f64,
) -> EpubResult<Option<ReaderRunDecoration>> {
    let decoration = &style.paint.text_decoration;
    let lines = decoration.lines;
    if lines.is_empty() {
        return Ok(None);
    }
    if !lines.underline && !lines.line_through {
        // Overline/blink alone have no protocol expression; drop them.
        return Ok(None);
    }
    // Combined lines pick the underline; non-solid strokes draw solid.
    // The underline's top row sits round(size/16) below the painted
    // baseline and its thickness grows as max(1, floor(size/10))
    // (measured against pinned Chromium 2026-08-03, seven sizes with a
    // layout-baseline probe: tops at baseline+1 for 12-20px and
    // baseline+2 for 24/32px, thickness 1/1/1/1/2/2/3 — the earlier
    // "hug the baseline" rule read its baseline reference one row high).
    // The renderer strokes centered on `y`, so the center rides the top
    // offset plus half a thickness below the baseline (rect top +
    // 0.8·size).
    let (kind, y, thickness) = if lines.underline {
        let thickness = (font_size / 10.0).floor().max(1.0);
        let top_offset = (font_size / 16.0).round();
        (
            ReaderRunDecorationKind::Underline,
            CANVAS_TOP_ASCENT_RATIO * font_size + top_offset + thickness / 2.0,
            thickness,
        )
    } else {
        (ReaderRunDecorationKind::LineThrough, font_size * 0.5, 1.0)
    };
    Ok(Some(ReaderRunDecoration {
        kind,
        y,
        thickness,
        color: css_color(decoration.color.resolve(style.paint.foreground))?,
    }))
}

/// Spacing is painter-visible (`canvas.letterSpacing`), so only the exact
/// pixel form the whitelist admits reaches here.
fn spacing_px(spacing: LengthPercentage) -> EpubResult<Option<f64>> {
    match spacing {
        LengthPercentage::Length(px) if px.get() != 0.0 => Ok(Some(f64::from(px.get()))),
        // Percentage and calc spacing have no canvas expression; they
        // paint unspaced rather than dropping the run.
        _ => Ok(None),
    }
}
