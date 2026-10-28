//! Vertical-rl lines painted as columns. Each line box is a column placed
//! in from the frame's right edge, and its clusters land where layout put
//! them down the line, across from the run's baseline by what layout
//! measured for each: an upright cluster's glyph, in its face's vertical
//! forms, from its horizontal origin, half its advance left of its centre
//! line and its face's vertical origin below its place (the column's top
//! on the whole-pixel grid, as the browser offsets it); a sideways stretch
//! as horizontal text turned a quarter clockwise about its start on its
//! alphabetic baseline. An inline image swaps its layout box back to
//! physical; a ruby annotation spreads its glyphs down the base span.

use rito_fragment::{
    ClusterOrientation, FontFaceId, FormattingNodeContent, FormattingTree, Fragment, InlineItem,
    LineFragment, TextFragment,
};

use std::collections::BTreeMap;

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::FlowItemSource;
use crate::render::contract::{ReaderPoint, ReaderRect, ReaderSize, ReaderTransform};
use crate::render::{
    display_number, display_rect, DisplayCommand, DisplayTextCommand, RunPaint, TextCluster,
};

use super::family::{face_family, vertical_forms_family};
use super::flow_text::FlowTexts;
use super::run_style::run_paint;
use super::{cluster_x, snap_css, CANVAS_TOP_ASCENT_RATIO};

/// How a placed cluster paints.
#[derive(Clone, Copy, PartialEq)]
enum Stance {
    /// Upright at its own origin.
    Upright,
    /// Part of a stretch turned a quarter clockwise.
    Sideways,
}

/// One cluster of a column run where it paints: its byte in the flow
/// text, its place down the line, its glyph origin (a sideways cluster's
/// baseline across), its face and its stance.
#[derive(Clone, Copy)]
struct Placed {
    byte: usize,
    place: f64,
    x: f64,
    y: f64,
    face: FontFaceId,
    stance: Stance,
}

/// Where a column run's clusters paint: `baseline_x` is the run's
/// baseline, `top` the column's top on the whole-pixel grid.
fn place_column_run(run: &TextFragment, font_size: f64, baseline_x: f64, top: f64) -> Vec<Placed> {
    run.clusters_with_origins()
        .enumerate()
        .map(|(index, (segment_x, cluster))| {
            let place = cluster_x(
                top + segment_x + run.ruby_center_shift_px + cluster.x,
                run.cluster_grid,
            );
            let byte = cluster.byte as usize;
            let orientation = run
                .orientations
                .as_deref()
                .and_then(|orientations| orientations.get(index).copied())
                .unwrap_or(ClusterOrientation::Upright {
                    center: 0.0,
                    half_advance: font_size / 2.0,
                    vertical_origin: CANVAS_TOP_ASCENT_RATIO * font_size,
                });
            let (x, y, stance) = match orientation {
                ClusterOrientation::Sideways { baseline } => {
                    (baseline_x - baseline, 0.0, Stance::Sideways)
                }
                ClusterOrientation::Upright {
                    center,
                    half_advance,
                    vertical_origin,
                } => (
                    baseline_x - center - half_advance,
                    place + vertical_origin,
                    Stance::Upright,
                ),
            };
            Placed {
                byte,
                place,
                x,
                y,
                face: cluster.face,
                stance,
            }
        })
        .collect()
}

/// Paints a column run's placed clusters: consecutive clusters of one
/// face and stance share a command, upright ones in the face's vertical
/// forms, and a sideways stretch turns a quarter clockwise about its start
/// on its baseline. `end` is the run's last byte and `run_bottom` where it
/// ends down the line.
#[allow(clippy::too_many_arguments)]
fn append_column_run_commands(
    commands: &mut Vec<DisplayCommand>,
    full_text: &str,
    placed: &[Placed],
    end: usize,
    run_bottom: f64,
    font_size: f64,
    paint_for: &dyn Fn(FontFaceId, bool) -> EpubResult<RunPaint>,
    href: Option<String>,
) -> EpubResult<()> {
    let text_command = |text: &str, rect: ReaderRect, clusters: Vec<TextCluster>, paint| {
        DisplayCommand::PaintText(DisplayTextCommand {
            text: text.into(),
            rect,
            paint,
            line_height_px: None,
            href: href.clone(),
            source_text: None,
            source_text_offset: None,
            clusters: clusters.into(),
        })
    };
    let mut start = 0;
    while start < placed.len() {
        let first = placed[start];
        let mut stop = start + 1;
        while placed
            .get(stop)
            .is_some_and(|next| next.stance == first.stance && next.face == first.face)
        {
            stop += 1;
        }
        let group_end = placed.get(stop).map_or(end, |next| next.byte);
        let bottom = placed.get(stop).map_or(run_bottom, |next| next.place);
        let length = bottom - first.place;
        let text = &full_text[first.byte..group_end];
        let paint = paint_for(first.face, first.stance == Stance::Upright)?;
        match first.stance {
            Stance::Upright => {
                let clusters = placed[start..stop]
                    .iter()
                    .map(|cluster| {
                        TextCluster::at((cluster.byte - first.byte) as u32, cluster.x, cluster.y)
                    })
                    .collect();
                commands.push(text_command(
                    text,
                    display_rect(first.x, first.place, font_size, length),
                    clusters,
                    paint,
                ));
            }
            Stance::Sideways => {
                // Set horizontally from the stretch's start on its
                // baseline, then turned a quarter clockwise about it: the
                // text runs down the column, its ascent towards the
                // line-over side.
                let origin = (first.x, first.place);
                let clusters = placed[start..stop]
                    .iter()
                    .map(|cluster| {
                        TextCluster::at(
                            (cluster.byte - first.byte) as u32,
                            origin.0 + (cluster.place - first.place),
                            origin.1,
                        )
                    })
                    .collect();
                commands.push(DisplayCommand::PushState);
                commands.push(DisplayCommand::Transform {
                    origin: ReaderPoint {
                        x: display_number(origin.0),
                        y: display_number(origin.1),
                    },
                    box_size: ReaderSize {
                        width: display_number(length),
                        height: display_number(font_size),
                    },
                    transforms: vec![ReaderTransform::Rotate {
                        radians: std::f64::consts::FRAC_PI_2,
                    }],
                });
                commands.push(text_command(
                    text,
                    display_rect(
                        origin.0,
                        origin.1 - CANVAS_TOP_ASCENT_RATIO * font_size,
                        length,
                        font_size,
                    ),
                    clusters,
                    paint,
                ));
                commands.push(DisplayCommand::PopState);
            }
        }
        start = stop;
    }
    Ok(())
}

/// Paints one vertical-rl line box as a downward text column whose
/// physical left edge is `column_x` and top `column_top` on the page.
#[allow(clippy::too_many_arguments)]
pub(super) fn append_vertical_line_commands(
    commands: &mut Vec<DisplayCommand>,
    tree: &FormattingTree,
    line: &LineFragment,
    column_x: f64,
    column_top: f64,
    faces: Option<&[std::sync::Arc<str>]>,
    flow_item_sources: Option<&BTreeMap<u32, Vec<FlowItemSource>>>,
    ruby_annotation_runs: Option<&BTreeMap<(u32, usize), rito_inline::MeasuredRuby>>,
    flow_texts: &FlowTexts,
) -> EpubResult<()> {
    let FormattingNodeContent::InlineFlow { items } = &tree.node(line.source).content else {
        return Err(EpubError::new("line fragment source is not an inline flow"));
    };
    let item_sources =
        flow_item_sources.and_then(|sources| sources.get(&line.source.0).map(Vec::as_slice));
    let styles = tree
        .styles()
        .ok_or_else(|| EpubError::new("formatting tree carries no style tables"))?;
    let flow_text = flow_texts.of(line.source, items);
    let (full_text, text_ranges) = (&flow_text.text, flow_text.item_ranges.as_slice());
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
            baseline_shift_px,
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
        // Upright glyphs paint in their face's vertical forms, the
        // variant the host registers beside each face it names.
        let family_for = |face, upright: bool| -> EpubResult<std::sync::Arc<str>> {
            let family = face_family(style, faces, face)?;
            Ok(if upright && faces.is_some() {
                std::sync::Arc::from(vertical_forms_family(&family))
            } else {
                family
            })
        };
        let paint_for = |face, upright: bool| -> EpubResult<RunPaint> {
            Ok(run_paint(
                style,
                family_for(face, upright)?,
                run.justify_px,
                false,
                false,
            )?
            .glyphs_only())
        };
        let font_size = f64::from(style.font.size.get());
        // The run's baseline lies the line's baseline in from its
        // line-over edge, less the item's own shift.
        let baseline_x = column_x + line.rect.height - (line.baseline - baseline_shift_px);
        let top = snap_css(column_top);
        let placed = place_column_run(run, font_size, baseline_x, top);
        append_column_run_commands(
            commands,
            full_text,
            &placed,
            end,
            top + run.rect.x + run.rect.width,
            font_size,
            &paint_for,
            item_sources
                .and_then(|sources| sources.get(*item_index))
                .and_then(|source| source.href.clone()),
        )?;
        // The annotation stands on the base's line-over side, wherever
        // the line's own edge is (a first line's annotation reaches into
        // the space before the line without growing it).
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
                    let measured_ruby = ruby_annotation_runs
                        .and_then(|runs| runs.get(&(line.source.0, *item_index)))
                        .ok_or_else(|| {
                            EpubError::new(
                                "vertical ruby annotation painted before its string was measured",
                            )
                        })?;
                    // A column annotation paints in the face its first
                    // cluster shaped with.
                    let annotation_face = measured_ruby
                        .run
                        .clusters
                        .first()
                        .map(|cluster| cluster.face)
                        .unwrap_or_default();
                    let base_paint = paint_for(
                        run.clusters
                            .first()
                            .map(|cluster| cluster.face)
                            .unwrap_or_default(),
                        false,
                    )?;
                    let upright = matches!(
                        measured_ruby
                            .orientations
                            .as_deref()
                            .and_then(|orientations| orientations.first()),
                        Some(ClusterOrientation::Upright { .. })
                    );
                    let ruby_paint = base_paint
                        .for_ruby(annotation_size)
                        .with_family(family_for(annotation_face, upright)?);
                    // The annotation's baseline stands `over_offset` past
                    // the base's on the line-over side (the base's em box
                    // and the annotation's under it), and its glyphs hang
                    // from it as a column run's do.
                    let annotation_baseline_x = baseline_x + measured_ruby.over_offset;
                    let (glyph_x, vertical_origin) = match measured_ruby
                        .orientations
                        .as_deref()
                        .and_then(|orientations| orientations.first())
                    {
                        Some(ClusterOrientation::Upright {
                            center,
                            half_advance,
                            vertical_origin,
                        }) => (
                            annotation_baseline_x - center - half_advance,
                            *vertical_origin,
                        ),
                        _ => (
                            annotation_baseline_x - annotation_size / 2.0,
                            measured_ruby.em_ascent,
                        ),
                    };
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
                            TextCluster::at(
                                byte as u32,
                                glyph_x,
                                span_top
                                    + share / 2.0
                                    + index as f64 * (annotation_size + share)
                                    + vertical_origin,
                            )
                        })
                        .collect();
                    commands.push(DisplayCommand::PaintRuby(DisplayTextCommand {
                        text: allocated.into(),
                        rect: display_rect(glyph_x, span_top, annotation_size, span),
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
