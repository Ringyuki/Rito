//! Emphasis marks painted beside the text they mark, where Blink's text
//! painter puts them (`TextPainter::SetEmphasisMark`,
//! `ShapeResultBloberizer::FillTextEmphasisGlyphs`): one mark for every
//! grapheme that takes one, at the centre of the grapheme's share of its
//! cluster's advance, the point the marks hang from lying outside the
//! text's em box by the mark's typo descent or ascent. A horizontal
//! line's mark sits on that point's baseline, its outline centred on the
//! grapheme less half the letter spacing; an upright mark in a vertical
//! line centres its outline on the point moved line-over by its face's
//! vertical baseline offset (`MeasuredEmphasis::upright_offset`); a mark
//! lying with a vertical
//! line's text sits like a horizontal line's, turned a quarter clockwise.
//! Marks paint as annotation text, after the text they mark.

use rito_fragment::{
    FontFaceId, FormattingTreeStyles, Fragment, InlineItem, LineFragment, TextFragment,
};
use rito_inline::MeasuredEmphasis;
use rito_style_contract::{InlineFormattingStyle, LengthPercentage, LineSide};

use crate::epub::EpubResult;
use crate::render::contract::{ReaderPoint, ReaderSize, ReaderTransform};
use crate::render::{display_number, display_rect, DisplayCommand, DisplayTextCommand, RunPaint};

use super::family::{css_color, face_family, vertical_forms_family};
use super::CANVAS_TOP_ASCENT_RATIO;

/// The start byte (in the run's text) and the origin along the line of
/// each of a run's clusters, `origin` being where the line starts: the
/// pen's float sum of shaped advances, before any whole-grid placement
/// of the glyphs (a mark centres on the shaped advance, Blink's
/// `ForEachGraphemeClusters`).
pub(super) fn cluster_origins(run: &TextFragment, origin: f64) -> Vec<(usize, f64)> {
    run.clusters_with_origins()
        .map(|(segment_x, cluster)| {
            (
                (cluster.byte - run.text_start) as usize,
                origin + segment_x + run.ruby_center_shift_px + cluster.x,
            )
        })
        .collect()
}

/// Where along the line the marks of a run's graphemes centre: each
/// cluster's advance (to the next cluster's origin, the last to `end`)
/// shared evenly among its graphemes, a mark at the middle of the share of
/// every grapheme that takes one. `clusters` holds each cluster's start
/// byte in `text` and its origin along the line.
pub(super) fn mark_places(text: &str, clusters: &[(usize, f64)], end: f64) -> Vec<f64> {
    let segmenter = icu_segmenter::GraphemeClusterSegmenter::new();
    let mut places = Vec::new();
    for (index, &(start, origin)) in clusters.iter().enumerate() {
        let (stop, next) = clusters
            .get(index + 1)
            .map_or((text.len(), end), |&(byte, origin)| (byte, origin));
        let Some(cluster) = text.get(start..stop) else {
            continue;
        };
        let breaks: Vec<usize> = segmenter.segment_str(cluster).collect();
        let graphemes = breaks.len().saturating_sub(1);
        if graphemes == 0 {
            continue;
        }
        let share = (next - origin) / graphemes as f64;
        for (grapheme, bounds) in breaks.windows(2).enumerate() {
            let takes = cluster[bounds[0]..bounds[1]]
                .chars()
                .next()
                .is_some_and(rito_inline::takes_emphasis_mark);
            if takes {
                places.push(origin + share * (grapheme as f64 + 0.5));
            }
        }
    }
    places
}

/// Where the advance of a run's last cluster ends along the line, the
/// line starting at `origin`: where the line's text resumes after the run,
/// less the inline box edges between them, when more of the line's text
/// follows it — a justified line's share after the cluster belongs to its
/// shaped advance (Blink's expansion opportunity) though the run's rect
/// stops short of it — and the run's own end, `end`, otherwise.
pub(super) fn last_advance_end(
    line: &LineFragment,
    run: &TextFragment,
    items: &[InlineItem],
    item_ranges: &[(std::ops::Range<usize>, usize)],
    styles: &FormattingTreeStyles,
    origin: f64,
    end: f64,
) -> f64 {
    let item_of = |byte: u32| {
        item_ranges
            .iter()
            .find(|(range, _)| range.contains(&(byte as usize)))
            .map(|(_, index)| *index)
    };
    let next = line.children.iter().find_map(|child| match child {
        Fragment::Text(next) if next.text_start == run.text_end => Some(next),
        _ => None,
    });
    let Some(next) = next else {
        return end;
    };
    let (Some(first), Some(this_item), Some(next_item)) = (
        cluster_origins(next, origin).first().copied(),
        item_of(run.text_start),
        item_of(next.text_start),
    ) else {
        return end;
    };
    let edges: f64 = items
        .get(this_item + 1..next_item)
        .unwrap_or_default()
        .iter()
        .filter_map(|item| match item {
            InlineItem::OpenTag { style } => Some((style, false)),
            InlineItem::CloseTag { style } => Some((style, true)),
            _ => None,
        })
        .filter_map(|(style, closes)| {
            let style = styles.inline.style(*style).ok()?;
            Some(f64::from(style.inline_edge(closes).size(None)))
        })
        .sum();
    first.1 - edges
}

/// The faces a run's clusters were shaped with.
pub(super) fn run_faces(run: &TextFragment) -> impl Iterator<Item = FontFaceId> + '_ {
    run.clusters.iter().map(|cluster| cluster.face)
}

/// The paint the marks of text in `style` take: the mark's face at its
/// size, in the emphasis color.
fn marks_paint(
    style: &InlineFormattingStyle,
    measured: &MeasuredEmphasis,
    family: std::sync::Arc<str>,
    run_paint: &RunPaint,
) -> EpubResult<RunPaint> {
    let Some(emphasis) = &style.text_flow.text_emphasis else {
        return Ok(run_paint.for_marks(measured.size, run_paint.color));
    };
    let color = css_color(emphasis.color.resolve(style.paint.foreground))?;
    Ok(run_paint
        .for_marks(measured.size, color)
        .with_family(family))
}

/// The marks command of a run on a horizontal line whose glyphs paint on
/// `baseline`, its marks centred at `places` along the line.
#[allow(clippy::too_many_arguments)]
pub(super) fn horizontal_marks(
    style: &InlineFormattingStyle,
    measured: &MeasuredEmphasis,
    faces: Option<&[std::sync::Arc<str>]>,
    run_paint: &RunPaint,
    run_faces: impl Iterator<Item = FontFaceId>,
    places: &[f64],
    baseline: f64,
) -> EpubResult<Option<DisplayCommand>> {
    let (Some(first), Some(last)) = (places.first(), places.last()) else {
        return Ok(None);
    };
    let distance = measured.distance(run_faces);
    let mark_baseline = match measured.side {
        LineSide::Over => baseline - distance,
        LineSide::Under => baseline + distance,
    };
    // Each mark's outline centres on its grapheme less half the letter
    // spacing the grapheme's advance carries.
    let shift = letter_spacing(style) / 2.0 + measured.ink_center.0;
    let mark = first_char(&measured.mark);
    let paint = marks_paint(
        style,
        measured,
        face_family(style, faces, measured.face)?,
        run_paint,
    )?;
    Ok(Some(marks_command(
        &mark,
        places
            .iter()
            .map(|place| (place - shift, mark_baseline))
            .collect(),
        display_rect(
            first - shift,
            mark_baseline - CANVAS_TOP_ASCENT_RATIO * measured.size,
            last - first + measured.size,
            measured.size,
        ),
        paint,
    )))
}

/// The marks commands of a run in a vertical line whose central baseline
/// lies at `baseline_x` across the page, its marks centred at `places`
/// down the column.
#[allow(clippy::too_many_arguments)]
pub(super) fn vertical_marks(
    style: &InlineFormattingStyle,
    measured: &MeasuredEmphasis,
    faces: Option<&[std::sync::Arc<str>]>,
    run_paint: &RunPaint,
    run_faces: impl Iterator<Item = FontFaceId>,
    places: &[f64],
    baseline_x: f64,
) -> EpubResult<Vec<DisplayCommand>> {
    let (Some(first), Some(last)) = (places.first(), places.last()) else {
        return Ok(Vec::new());
    };
    let distance = measured.distance(run_faces);
    // The line-over side of a vertical line is its right.
    let across = match measured.side {
        LineSide::Over => baseline_x + distance,
        LineSide::Under => baseline_x - distance,
    };
    let mark = first_char(&measured.mark);
    let family = face_family(style, faces, measured.face)?;
    let (center_x, center_y) = measured.ink_center;
    if measured.upright {
        let family = match faces {
            Some(_) => std::sync::Arc::from(vertical_forms_family(&family)),
            None => family,
        };
        let paint = marks_paint(style, measured, family, run_paint)?;
        return Ok(vec![marks_command(
            &mark,
            places
                .iter()
                .map(|place| {
                    (
                        across + measured.upright_offset - center_x,
                        place - center_y,
                    )
                })
                .collect(),
            display_rect(
                across - measured.size / 2.0,
                first - measured.size / 2.0,
                measured.size,
                last - first + measured.size,
            ),
            paint,
        )]);
    }
    // Lying with the text: set horizontally down from the first mark's
    // place on the point's line, then turned a quarter clockwise about
    // that start.
    let paint = marks_paint(style, measured, family, run_paint)?;
    let shift = letter_spacing(style) / 2.0 + center_x;
    let origin = (across, first - shift);
    let length = last - first + measured.size;
    Ok(vec![
        DisplayCommand::PushState,
        DisplayCommand::Transform {
            origin: ReaderPoint {
                x: display_number(origin.0),
                y: display_number(origin.1),
            },
            box_size: ReaderSize {
                width: display_number(length),
                height: display_number(measured.size),
            },
            transforms: vec![ReaderTransform::Rotate {
                radians: std::f64::consts::FRAC_PI_2,
            }],
        },
        marks_command(
            &mark,
            places
                .iter()
                .map(|place| (origin.0 + (place - shift - origin.1), origin.1))
                .collect(),
            display_rect(
                origin.0,
                origin.1 - CANVAS_TOP_ASCENT_RATIO * measured.size,
                length,
                measured.size,
            ),
            paint,
        ),
        DisplayCommand::PopState,
    ])
}

/// One mark per origin, painted as annotation text.
fn marks_command(
    mark: &str,
    origins: Vec<(f64, f64)>,
    rect: crate::render::contract::ReaderRect,
    paint: RunPaint,
) -> DisplayCommand {
    let text = mark.repeat(origins.len());
    let clusters = origins
        .into_iter()
        .enumerate()
        .map(|(index, (x, y))| crate::render::TextCluster::at((index * mark.len()) as u32, x, y))
        .collect();
    DisplayCommand::PaintRuby(DisplayTextCommand {
        text: text.into(),
        rect,
        paint,
        line_height_px: None,
        href: None,
        source_text: None,
        source_text_offset: None,
        clusters,
    })
}

/// The mark's first character: the glyph a mark paints.
fn first_char(mark: &str) -> String {
    mark.chars().next().map(String::from).unwrap_or_default()
}

/// The style's letter spacing in pixels, as its runs paint it.
fn letter_spacing(style: &InlineFormattingStyle) -> f64 {
    match style.text_flow.letter_spacing {
        LengthPercentage::Length(length) => f64::from(length.get()),
        _ => 0.0,
    }
}

#[cfg(test)]
mod tests {
    use super::mark_places;

    #[test]
    fn a_mark_centres_on_each_grapheme_that_takes_one() {
        // 甲 and 乙 take marks; the ideographic comma and the space do not.
        let text = "甲、乙 ";
        let clusters = [(0, 0.0), (3, 16.0), (6, 32.0), (9, 48.0)];
        assert_eq!(mark_places(text, &clusters, 52.0), [8.0, 40.0]);
    }

    #[test]
    fn a_cluster_of_several_graphemes_shares_its_advance() {
        let text = "ab";
        assert_eq!(mark_places(text, &[(0, 10.0)], 30.0), [15.0, 25.0]);
    }
}
