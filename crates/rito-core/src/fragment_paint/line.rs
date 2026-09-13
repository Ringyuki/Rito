//! One horizontal line box: the outside disc marker filled with the
//! line's text colour, each inline item's extent on the line (the run
//! closing an item ends on the 1/64 layout grid), and the dispatch of
//! every child to the text-run painter, the image painter or, for an
//! inline-block atom, this painter again over the atom's own lines.

use rito_fragment::{FormattingNodeContent, FormattingTree, Fragment, InlineItem, LineFragment};

use std::collections::BTreeMap;

use crate::epub::{EpubError, EpubResult};
use crate::fragment_bridge::{FlowItemSource, NodePaint};
use crate::render::contract::{
    ReaderBackgroundPaint, ReaderBlockPaint, ReaderBlockRadius, ReaderColor,
};
use crate::render::{display_rect, DisplayCommand};

use super::family::css_color;
use super::image::append_image_command;
use super::text_run::append_text_run_command;
use super::PaintFamilyPolicy;

#[allow(clippy::too_many_arguments)]
pub(super) fn append_line_commands(
    commands: &mut Vec<DisplayCommand>,
    tree: &FormattingTree,
    line: &LineFragment,
    origin_x: f64,
    origin_y: f64,
    family_policy: Option<&PaintFamilyPolicy>,
    image_border_paints: Option<&BTreeMap<u32, (NodePaint, [f64; 4])>>,
    flow_item_sources: Option<&BTreeMap<u32, Vec<FlowItemSource>>>,
    ruby_annotation_runs: Option<&BTreeMap<(u32, usize), rito_inline::MeasuredRuby>>,
    snap_origin_y: f64,
    ratio: f64,
) -> EpubResult<()> {
    let FormattingNodeContent::InlineFlow { items } = &tree.node(line.source).content else {
        return Err(EpubError::new("line fragment source is not an inline flow"));
    };
    let item_sources =
        flow_item_sources.and_then(|sources| sources.get(&line.source.0).map(Vec::as_slice));
    let styles = tree
        .styles()
        .ok_or_else(|| EpubError::new("formatting tree carries no style tables"))?;
    // Text fragments address the flow's concatenated item text by byte
    // range; rebuild that concatenation to slice run text and map each run
    // back to the item whose style paints it.
    let mut full_text = String::new();
    let mut text_ranges: Vec<(std::ops::Range<usize>, usize)> = Vec::new();
    for (item_index, item) in items.iter().enumerate() {
        if let InlineItem::Text { text, .. } = item {
            let start = full_text.len();
            full_text.push_str(text);
            text_ranges.push((start..full_text.len(), item_index));
        }
    }
    let line_x = origin_x + line.rect.x;
    let line_y = origin_y + line.rect.y;
    // The list item's outside disc marker, filled with the line's text
    // color (Blink inherits the item's `color`). Geometry comes from the
    // layout side (see rito_fragment::MarkerFragment).
    if let Some(marker) = &line.marker {
        let color = items
            .iter()
            .find_map(|item| match item {
                InlineItem::Text { style, .. } => Some(*style),
                _ => None,
            })
            .and_then(|style| styles.inline.style(style).ok())
            .map(|style| css_color(style.paint.foreground))
            .transpose()?
            .unwrap_or(ReaderColor::BLACK);
        commands.push(DisplayCommand::PaintBlock {
            rect: display_rect(
                line_x + marker.x,
                line_y + marker.y,
                marker.diameter,
                marker.diameter,
            ),
            paint: ReaderBlockPaint {
                background: Some(ReaderBackgroundPaint {
                    color: Some(color),
                    ..ReaderBackgroundPaint::default()
                }),
                radius: Some(ReaderBlockRadius::Px(marker.diameter / 2.0)),
                ..ReaderBlockPaint::default()
            },
            border_box: None,
        });
    }
    // Each item's extent on this line. The browser lays an item's line
    // fragment out at LayoutUnit precision — its right edge, where the
    // item's inline box band and decoration line end, sits at the
    // item's start plus its shaped width ceiled onto the 1/64 grid —
    // while the runs inside it accumulate in float; the run closing an
    // item takes that edge as its rect's end.
    let mut item_extents: BTreeMap<usize, (f64, f64)> = BTreeMap::new();
    for child in &line.children {
        if let Fragment::Text(run) = child {
            let (start, end) = (run.text_start as usize, run.text_end as usize);
            if let Some((_, item_index)) = text_ranges
                .iter()
                .find(|(range, _)| range.start <= start && end <= range.end)
            {
                let extent = item_extents
                    .entry(*item_index)
                    .or_insert((f64::INFINITY, f64::NEG_INFINITY));
                extent.0 = extent.0.min(run.rect.x);
                extent.1 = extent.1.max(run.rect.x + run.rect.width);
            }
        }
    }
    for child in &line.children {
        match child {
            Fragment::Text(run) => {
                append_text_run_command(
                    commands,
                    items,
                    styles,
                    &full_text,
                    &text_ranges,
                    &item_extents,
                    line,
                    run,
                    line_x,
                    line_y,
                    family_policy,
                    item_sources,
                    ruby_annotation_runs,
                    snap_origin_y,
                    ratio,
                )?;
            }
            Fragment::Image(image) => {
                let item_source =
                    item_sources.and_then(|sources| sources.get(image.item_index as usize));
                append_image_command(
                    commands,
                    items,
                    image,
                    line_x,
                    line_y,
                    image_border_paints,
                    item_source,
                )?;
            }
            Fragment::Box(atom) => {
                // An inline-block atom riding the line: its mini
                // paragraph's lines paint in the atom's frame. Box
                // decorations on the atom itself are not modelled yet.
                for inner in &atom.children {
                    let Fragment::Line(inner_line) = inner else {
                        continue;
                    };
                    append_line_commands(
                        commands,
                        tree,
                        inner_line,
                        line_x + atom.rect.x,
                        line_y + atom.rect.y,
                        family_policy,
                        image_border_paints,
                        flow_item_sources,
                        ruby_annotation_runs,
                        snap_origin_y,
                        ratio,
                    )?;
                }
            }
            Fragment::Line(_) => {
                return Err(EpubError::new(
                    "line boxes contain only text, image, and inline-block fragments",
                ));
            }
        }
    }
    Ok(())
}
