//! Where each cluster of a painted run sits: the origins the browser's
//! pen steps to from the run's start, so the renderer draws every cluster
//! where layout put it instead of shaping the run again.
//!
//! The step from one cluster to the next is its bare glyph advance on the
//! browser's 16.16 fixed-point scale, plus the spacing layout folded into
//! it (author spacing, a trim, a box gap, a ruby gap), plus the justify
//! share the line gave it. Two accumulation laws, both measured against
//! pinned Chromium: an all-CJK run at a fractional font size lands every
//! cluster on the 1/64 CSS-pixel grid (floor of the running sum: 21 of 21
//! positions on a 12.16px line), and everything else accumulates in float
//! the way the browser's own text pen does, so a kerned Latin word's
//! sub-pixel phases match its raster.

use rito_fragment::ClusterPosition;
use rito_style_contract::{InlineFormattingStyleV1, LengthPercentage};

use crate::*;

/// The cluster origins of one piece of a laid-out paragraph, relative to
/// the piece's start, and where the pen rests after the last of them.
pub(crate) struct PieceClusters {
    pub positions: Vec<ClusterPosition>,
    /// Whether the painter floors the absolute positions onto the 1/64
    /// grid.
    pub grid: bool,
    /// The pen's position after the last cluster, from the piece's start,
    /// accumulated under the same law as the positions.
    pub advance: f64,
}

/// The cluster origins of the piece `range` of a laid-out paragraph.
/// `halt_trims` are the openers shaped with the `halt` half-width
/// variant: the painter draws the untrimmed glyph, whose outline sits one
/// blank half further right, so such a cluster's origin moves left by its
/// half while the clusters after it keep the trimmed advance layout
/// stepped by.
pub(crate) fn piece_clusters(
    layout: &parley::Layout<[u8; 4]>,
    flow_text: &str,
    range: std::ops::Range<usize>,
    spacing_edits: &SpacingEdits,
    justify_px: f64,
    halt_trims: &[(std::ops::Range<usize>, f64)],
    word_spacing: bool,
) -> PieceClusters {
    let mut steps: Vec<(u32, f64, f64)> = Vec::new();
    let mut font_size = 0.0_f64;
    let mut cluster = parley::layout::Cluster::from_byte_index(layout, range.start);
    while let Some(current) = cluster {
        let text_range = current.text_range();
        if text_range.start >= range.end {
            break;
        }
        if steps.is_empty() {
            font_size = f64::from(current.run().font_size());
        }
        let folded = spacing_edits
            .iter()
            .rev()
            .find(|(edited, _)| edited.contains(&text_range.start))
            .map_or(0.0, |(_, spacing)| f64::from(*spacing));
        let step = hb_fixed_cluster_advance(&current, folded) + justify_px;
        let trim = halt_trims
            .iter()
            .find(|(trimmed, _)| *trimmed == text_range)
            .map_or(0.0, |(_, half)| *half);
        steps.push((text_range.start as u32, step, trim));
        cluster = current.next_logical();
    }
    let text = flow_text.get(range).unwrap_or_default();
    let grid = !word_spacing
        && (font_size * 64.0).fract() != 0.0
        && !text.is_empty()
        && text.chars().all(is_cjk_cluster_char);
    let mut positions = Vec::with_capacity(steps.len());
    let advance = if grid {
        let mut cumulative = 0.0_f64;
        for (byte, step, trim) in steps {
            positions.push(ClusterPosition {
                byte,
                x: cumulative - trim,
            });
            cumulative += step;
        }
        cumulative
    } else {
        let mut pen = 0.0_f32;
        for (byte, step, trim) in steps {
            positions.push(ClusterPosition {
                byte,
                x: f64::from(pen) - trim,
            });
            pen += step as f32;
        }
        f64::from(pen)
    };
    PieceClusters {
        positions,
        grid,
        advance,
    }
}

/// A string shaped on its own in one style — an outside list marker — as
/// the engine places it: the inline size its box takes and where every
/// cluster sits from the box's start.
#[derive(Clone, Debug, PartialEq)]
pub struct MeasuredRun {
    /// The box's inline size: the shaped advance quantized the way the
    /// browser's layout stores an inline box's width (1/64 CSS px,
    /// ceiling).
    pub advance: f64,
    /// Every cluster's origin from the box's start, in text order (byte
    /// offset into the string, CSS x).
    pub clusters: Vec<ClusterPosition>,
    /// Whether the painter floors the absolute origins onto the 1/64 grid.
    pub grid: bool,
}

impl ParleyInlineContext {
    /// Shapes `text` in `style` as one line and measures it the way a
    /// painted run is placed: the box's inline size and each cluster's
    /// origin under the cluster laws above, with the style's own letter
    /// spacing folded in and no justification.
    pub fn measure_run(&self, style: &InlineFormattingStyleV1, text: &str) -> MeasuredRun {
        if text.is_empty() {
            return MeasuredRun {
                advance: 0.0,
                clusters: Vec::new(),
                grid: false,
            };
        }
        let mut fonts = self.fonts.borrow_mut();
        let mut layouts = self.layouts.borrow_mut();
        let mut builder = SpacingBuilder::new(layouts.ranged_builder(&mut fonts, text, 1.0, true));
        push_item_styles(&mut builder, style, 0..text.len());
        let (mut layout, spacing_edits) = builder.build(text);
        layout.break_all_lines(None);
        let word_spacing = matches!(
            style.text_flow.word_spacing,
            LengthPercentage::Length(px) if px.get() != 0.0
        );
        let piece = piece_clusters(
            &layout,
            text,
            0..text.len(),
            &spacing_edits,
            0.0,
            &[],
            word_spacing,
        );
        MeasuredRun {
            advance: layout_unit_ceil(piece.advance),
            clusters: piece.positions,
            grid: piece.grid,
        }
    }
}

/// The CJK blocks whose clusters shape one to one with no kerning, plus
/// the middle dot that rides between ideographs the same way.
fn is_cjk_cluster_char(character: char) -> bool {
    matches!(
        u32::from(character),
        0xB7 | 0x2E80..=0x9FFF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF | 0x20000..=0x3FFFF
    )
}
