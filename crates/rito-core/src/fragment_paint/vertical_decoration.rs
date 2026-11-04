//! A vertical run's decoration lines, where Chromium draws them: beside the
//! column, a gap off the em box, at whatever fractional place the text box
//! puts them (measured against pinned Chromium at 12–32px: the line keeps
//! the text box's half-pixel phases).

use rito_fragment::TextFragment;
use rito_style_contract::InlineFormattingStyle;

use crate::epub::EpubResult;
use crate::render::{display_rect, DisplayCommand};

use super::family::css_color;

/// The underline and overline of `run` drawn down the page from `top` for
/// its length, across from the run's baseline at `baseline_x`;
/// none when the run draws neither or its font box did not resolve.
///
/// Blink places each line from the text box's line-over edge, measuring
/// the em box from half the font's integer height (the run's font box,
/// `ascent` + `descent` around its central baseline). Japanese and Korean
/// text swaps the two lines: its
/// underline sits past the em box's over edge by a one-pixel gap and the
/// line's thickness (`ComputeUnderlineOffsetForUnder` at
/// `TopOfEmHeight`), its overline one pixel past the em box's under edge
/// (at `BottomOfEmHeight`, where other text puts its underline), and other
/// text's overline sits just outside the text box's over edge (at
/// `TextTop`).
pub(super) fn vertical_decorations(
    style: &InlineFormattingStyle,
    run: &TextFragment,
    baseline_x: f64,
    top: f64,
) -> EpubResult<Vec<DisplayCommand>> {
    let decoration = &style.paint.text_decoration;
    let lines = decoration.lines;
    if !lines.underline && !lines.overline {
        return Ok(Vec::new());
    }
    let Some((ascent, descent)) = run.font_grid else {
        return Ok(Vec::new());
    };
    let font_size = f64::from(style.font.size.get());
    let thickness = (font_size / 10.0).floor().max(1.0);
    let height = ascent + descent;
    let half_over = height - (height * 32.0).trunc() / 64.0;
    let layout_unit = |value: f64| (value * 64.0).round() / 64.0;
    let over_em = layout_unit(half_over - font_size / 2.0).floor() - 1.0 - thickness;
    let under_em = layout_unit(half_over + font_size / 2.0).floor() + 1.0;
    let swapped = swaps_lines(style);
    let mut offsets = Vec::new();
    if lines.underline {
        offsets.push(if swapped { over_em } else { under_em });
    }
    if lines.overline {
        offsets.push(if swapped { under_em } else { -thickness });
    }
    // The text box's over edge, `ascent` over the run's baseline (the
    // run's font box, as its records place it).
    let over_edge = baseline_x + ascent;
    let color = css_color(decoration.color.resolve(style.paint.foreground))?;
    Ok(offsets
        .into_iter()
        .map(|from_over_edge| {
            let right = over_edge - from_over_edge;
            DisplayCommand::PaintDecoration {
                rect: display_rect(
                    right - thickness,
                    top + run.rect.x,
                    thickness,
                    run.rect.width,
                ),
                color,
            }
        })
        .collect())
}

/// Whether vertical text swaps its underline and overline: text whose
/// language writes kana or hangul (Blink's `ResolveUnderlinePosition`
/// over the font's script).
fn swaps_lines(style: &InlineFormattingStyle) -> bool {
    style.text_flow.language.as_ref().is_some_and(|tag| {
        let primary = tag.as_str().split(['-', '_']).next().unwrap_or("");
        primary.eq_ignore_ascii_case("ja") || primary.eq_ignore_ascii_case("ko")
    })
}

/// Adds item `item`'s `line` to the decoration lines collected for one
/// column, joined to the line before it where it continues it: the browser
/// strokes one line along a text item that the column paints in pieces.
pub(super) fn push_joined(
    lines: &mut Vec<(usize, DisplayCommand)>,
    item: usize,
    line: DisplayCommand,
) {
    if let (
        Some((
            last_item,
            DisplayCommand::PaintDecoration {
                rect: last,
                color: last_color,
            },
        )),
        DisplayCommand::PaintDecoration { rect, color },
    ) = (lines.last_mut(), &line)
    {
        if *last_item == item
            && last.x == rect.x
            && last.width == rect.width
            && last_color == color
            && (last.y + last.height - rect.y).abs() < 1e-3
        {
            last.height = rect.y + rect.height - last.y;
            return;
        }
    }
    lines.push((item, line));
}
