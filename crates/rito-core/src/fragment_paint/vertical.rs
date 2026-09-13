//! Vertical-rl lines painted as downward columns. Each line box becomes a
//! column placed in from the frame's right edge; a text run paints glyph
//! by glyph one step (font size plus letter spacing) down the column,
//! with bracket, dash and leader marks rotated a quarter turn about their
//! em centre and comma and period marks shifted into the em's top-right
//! corner; an inline image swaps its layout box back to physical; a ruby
//! annotation spreads its glyphs down the base span.

use rito_fragment::{FormattingNodeContent, FormattingTree, Fragment, InlineItem, LineFragment};

use std::collections::BTreeMap;

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::FlowItemSource;
use crate::render::contract::{ReaderPoint, ReaderRect, ReaderSize, ReaderTransform};
use crate::render::{display_number, display_rect, DisplayCommand, DisplayTextCommand, RunPaint};

use super::run_style::run_paint;
use super::{PaintFamilyPolicy, CANVAS_TOP_ASCENT_RATIO};

/// Punctuation that takes its vertical presentation in a column: brackets,
/// dashes and leaders are the horizontal glyph rotated a quarter turn
/// about its em center (how the `vert` feature draws them); comma and
/// period marks sit in the em's top-right corner instead of bottom-left.
const VERTICAL_ROTATED: &str = "「」『』()（）〔〕［］[]{}｛｝〈〉《》【】〖〗…‥ー―—–~〜～＝=";
const VERTICAL_SHIFTED: &str = "、。，．,.";

/// Paints one column run glyph by glyph: every code point sits upright
/// one step (the font size plus letter spacing) below the last, its
/// baseline 0.8 em below the run's top, the way the browser's column pen
/// stepped. Consecutive upright glyphs share one run with a cluster
/// origin each; a rotated mark paints as its own run under a quarter-turn
/// transform about its em center.
fn append_vertical_run_commands(
    commands: &mut Vec<DisplayCommand>,
    text: &str,
    paint: &RunPaint,
    font_size: f64,
    glyph_x: f64,
    top: f64,
    href: Option<String>,
) {
    let step = font_size + paint.letter_spacing_px.unwrap_or(0.0);
    let run = |text: String, rect: ReaderRect, clusters: Vec<(u32, f64, f64)>| {
        DisplayCommand::PaintText(DisplayTextCommand {
            text,
            rect,
            paint: paint.clone(),
            line_height_px: None,
            href: href.clone(),
            source_text: None,
            source_text_offset: None,
            clusters,
        })
    };
    let mut segment: Vec<(u32, f64, f64)> = Vec::new();
    let mut segment_start = 0usize;
    let mut segment_end = 0usize;
    let mut segment_top = top;
    let flush = |commands: &mut Vec<DisplayCommand>,
                 segment: &mut Vec<(u32, f64, f64)>,
                 start: usize,
                 end: usize,
                 segment_top: f64| {
        if segment.is_empty() {
            return;
        }
        let length = segment.len() as f64 * step;
        commands.push(run(
            text[start..end].to_owned(),
            display_rect(glyph_x, segment_top, font_size, length),
            std::mem::take(segment),
        ));
    };
    for (index, (byte, glyph)) in text.char_indices().enumerate() {
        let glyph_top = top + index as f64 * step;
        let pen_y = glyph_top + CANVAS_TOP_ASCENT_RATIO * font_size;
        if VERTICAL_ROTATED.contains(glyph) {
            flush(commands, &mut segment, segment_start, byte, segment_top);
            let center_x = glyph_x + font_size / 2.0;
            let center_y = pen_y - 0.3 * font_size;
            commands.push(DisplayCommand::PushState);
            commands.push(DisplayCommand::Transform {
                origin: ReaderPoint {
                    x: display_number(center_x),
                    y: display_number(center_y),
                },
                box_size: ReaderSize {
                    width: display_number(font_size),
                    height: display_number(font_size),
                },
                transforms: vec![ReaderTransform::Rotate {
                    radians: std::f64::consts::FRAC_PI_2,
                }],
            });
            commands.push(run(
                glyph.to_string(),
                display_rect(glyph_x, glyph_top, font_size, font_size),
                vec![(0, glyph_x, pen_y)],
            ));
            commands.push(DisplayCommand::PopState);
            segment_start = byte + glyph.len_utf8();
            segment_end = segment_start;
            continue;
        }
        if segment.is_empty() {
            segment_start = byte;
            segment_top = glyph_top;
        }
        let origin = if VERTICAL_SHIFTED.contains(glyph) {
            (glyph_x + 0.5 * font_size, pen_y - 0.6 * font_size)
        } else {
            (glyph_x, pen_y)
        };
        segment.push(((byte - segment_start) as u32, origin.0, origin.1));
        segment_end = byte + glyph.len_utf8();
    }
    flush(
        commands,
        &mut segment,
        segment_start,
        segment_end,
        segment_top,
    );
}

/// Paints one vertical-rl line box as a downward text column. The line
/// laid out with the horizontal engine in the swapped page (inline axis
/// = column length), so `box_inline`/`box_block` are LOGICAL offsets:
/// the accumulated block offset measures in from the frame's right edge
/// and the inline offset down from its top.
#[allow(clippy::too_many_arguments)]
pub(super) fn append_vertical_line_commands(
    commands: &mut Vec<DisplayCommand>,
    tree: &FormattingTree,
    line: &LineFragment,
    box_inline: f64,
    box_block: f64,
    frame_right: f64,
    frame_top: f64,
    family_policy: Option<&PaintFamilyPolicy>,
    flow_item_sources: Option<&BTreeMap<u32, Vec<FlowItemSource>>>,
    ruby_annotation_runs: Option<&BTreeMap<(u32, usize), rito_inline::MeasuredRuby>>,
) -> EpubResult<()> {
    let FormattingNodeContent::InlineFlow { items } = &tree.node(line.source).content else {
        return Err(EpubError::new("line fragment source is not an inline flow"));
    };
    let item_sources =
        flow_item_sources.and_then(|sources| sources.get(&line.source.0).map(Vec::as_slice));
    let styles = tree
        .styles()
        .ok_or_else(|| EpubError::new("formatting tree carries no style tables"))?;
    let mut full_text = String::new();
    let mut text_ranges: Vec<(std::ops::Range<usize>, usize)> = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        if let InlineItem::Text { text, .. } = item {
            let start = full_text.len();
            full_text.push_str(text);
            text_ranges.push((start..full_text.len(), item_index));
        }
    }
    let column_x = frame_right - (box_block + line.rect.y + line.rect.height);
    let column_top = frame_top + box_inline + line.rect.x;
    for child in &line.children {
        // A replaced atom in a vertical line: the layout box is the
        // swapped one (advance = physical height), so the device rect
        // swaps back — column position from the line, the atom's inline
        // offset down the page, physical width x height — and the
        // raster paints unrotated, clipping at the page edge like the
        // reference.
        if let Fragment::Image(image) = child {
            let Some(InlineItem::Image { src, .. }) = items.get(image.item_index as usize) else {
                continue;
            };
            let item_source =
                item_sources.and_then(|sources| sources.get(image.item_index as usize));
            commands.push(DisplayCommand::paint_image(
                src.clone(),
                display_rect(
                    column_x,
                    column_top + image.rect.x,
                    image.rect.height,
                    image.rect.width,
                ),
                item_source.and_then(|source| source.image_alt.clone()),
                item_source.and_then(|source| source.href.clone()),
            ));
            continue;
        }
        let Fragment::Text(run) = child else { continue };
        let start = run.text_start as usize;
        let end = run.text_end as usize;
        let Some((_, item_index)) = text_ranges
            .iter()
            .find(|(range, _)| range.start <= start && end <= range.end)
        else {
            continue;
        };
        let InlineItem::Text {
            style,
            ruby_annotation,
            ..
        } = &items[*item_index]
        else {
            continue;
        };
        let style = styles
            .inline
            .style(*style)
            .map_err(|error| EpubError::new(format!("text run has no inline style: {error}")))?;
        // A column run paints glyphs only: its inline box and decoration
        // have no column expression yet.
        let base_paint =
            run_paint(style, family_policy, run.justify_px, false, false)?.glyphs_only();
        let font_size = f64::from(style.font.size.get());
        // The glyph column centers on the line's STRUT: an annotation's
        // growth lands entirely on the line's right (matrix-measured:
        // the base keeps its plain-line distance from the left edge and
        // the annotation column pushes the right edge out), so the
        // centering basis excludes the growth.
        let glyph_x = column_x + (line.rect.height - line.ruby_growth - font_size) / 2.0;
        append_vertical_run_commands(
            commands,
            &full_text[start..end],
            &base_paint,
            font_size,
            glyph_x,
            column_top + run.rect.x,
            item_sources
                .and_then(|sources| sources.get(*item_index))
                .and_then(|source| source.href.clone()),
        );
        // The annotation rides the column's LEFT-out side? No: probed on
        // a vertical-rl ruby line, the annotation column sits between
        // the base and the NEXT line — its right edge on the line box's
        // right edge (rt 803.5..812.5 in a 782..812 line box, size 8).
        if let Some(annotation) = ruby_annotation {
            let item_range = {
                let (range, _) = &text_ranges[text_ranges
                    .iter()
                    .position(|(_, index)| index == item_index)
                    .unwrap_or(0)];
                range.clone()
            };
            let total_chars = full_text
                .get(item_range.clone())
                .map_or(0.0, |base| base.chars().count() as f64);
            let seg_start = full_text
                .get(item_range.start..start)
                .map_or(0.0, |prefix| prefix.chars().count() as f64);
            let seg_end_ratio = if end >= item_range.end {
                f64::INFINITY
            } else {
                full_text
                    .get(item_range.start..end)
                    .map_or(0.0, |prefix| prefix.chars().count() as f64)
                    / total_chars
            };
            if total_chars > 0.0 {
                let allocated = rito_fragment::allocate_ruby_annotation(
                    &annotation.text,
                    seg_start / total_chars,
                    seg_end_ratio,
                );
                if !allocated.is_empty() {
                    let annotation_size = font_size * f64::from(annotation.size_ratio);
                    // Down a column every annotation glyph paints at its
                    // alphabetic baseline one em-box ascent below its
                    // glyph top (the annotation's own typo ascent, what
                    // the browser's canvas resolves a top anchor to).
                    let em_ascent = ruby_annotation_runs
                        .and_then(|runs| runs.get(&(line.source.0, *item_index)))
                        .ok_or_else(|| {
                            EpubError::new(
                                "vertical ruby annotation painted before its string was measured",
                            )
                        })?
                        .em_ascent;
                    let ruby_paint = base_paint.for_ruby(annotation_size);
                    let annotation_x = column_x + line.rect.height - annotation_size;
                    let span_top = column_top + run.rect.x - run.ruby_overhang_px;
                    let span = run.rect.width + run.ruby_overhang_px + run.ruby_overhang_right_px;
                    // The column annotation spreads down its base span
                    // the way the initial `ruby-align` spreads: the free
                    // length splits into one share per glyph, half a
                    // share at each edge, every glyph's top one
                    // annotation size plus a share below the last.
                    let glyphs = allocated.chars().count().max(1) as f64;
                    let share = (span - glyphs * annotation_size) / glyphs;
                    let clusters = allocated
                        .char_indices()
                        .enumerate()
                        .map(|(index, (byte, _))| {
                            (
                                byte as u32,
                                annotation_x,
                                span_top
                                    + share / 2.0
                                    + index as f64 * (annotation_size + share)
                                    + em_ascent,
                            )
                        })
                        .collect();
                    commands.push(DisplayCommand::PaintRuby(DisplayTextCommand {
                        text: allocated,
                        rect: display_rect(annotation_x, span_top, annotation_size, span),
                        paint: ruby_paint,
                        line_height_px: None,
                        href: None,
                        source_text: None,
                        source_text_offset: None,
                        clusters,
                    }));
                }
            }
        }
    }
    Ok(())
}
