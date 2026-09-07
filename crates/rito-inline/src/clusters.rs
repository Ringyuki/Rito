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

use crate::*;

/// The cluster origins of the piece `range` of a laid-out paragraph,
/// relative to the piece's start, and whether the painter floors their
/// absolute positions onto the 1/64 grid. `halt_trims` are the openers
/// shaped with the `halt` half-width variant: the painter draws the
/// untrimmed glyph, whose outline sits one blank half further right, so
/// such a cluster's origin moves left by its half while the clusters
/// after it keep the trimmed advance layout stepped by.
pub(crate) fn piece_clusters(
    layout: &parley::Layout<[u8; 4]>,
    flow_text: &str,
    range: std::ops::Range<usize>,
    spacing_edits: &SpacingEdits,
    justify_px: f64,
    halt_trims: &[(std::ops::Range<usize>, f64)],
    word_spacing: bool,
) -> (Vec<ClusterPosition>, bool) {
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
    let mut clusters = Vec::with_capacity(steps.len());
    if grid {
        let mut cumulative = 0.0_f64;
        for (byte, step, trim) in steps {
            clusters.push(ClusterPosition {
                byte,
                x: cumulative - trim,
            });
            cumulative += step;
        }
    } else {
        let mut pen = 0.0_f32;
        for (byte, step, trim) in steps {
            clusters.push(ClusterPosition {
                byte,
                x: f64::from(pen) - trim,
            });
            pen += step as f32;
        }
    }
    (clusters, grid)
}

/// The CJK blocks whose clusters shape one to one with no kerning, plus
/// the middle dot that rides between ideographs the same way.
fn is_cjk_cluster_char(character: char) -> bool {
    matches!(
        u32::from(character),
        0xB7 | 0x2E80..=0x9FFF | 0xF900..=0xFAFF | 0xFF00..=0xFFEF | 0x20000..=0x3FFFF
    )
}
