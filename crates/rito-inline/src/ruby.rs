//! Ruby: joining a spread base's fragments so one annotation paints over
//! one extent.

use rito_fragment::ClusterPosition;

use crate::*;

/// Applies accepted line-end trims as negative letter-spacing on the
/// closing glyph itself — the same mechanism as the pair trims, so the
/// trimmed character is isolated in its own glyph run and the paint stays
/// position-exact. The blank right half collapses; the ink does not move.
/// Re-fuses the text fragments a ruby spread's letter-spacing edit split
/// apart, so each spread base paints (and carries its annotation) as one
/// fragment per line, its cluster origins re-based onto the first
/// fragment's start so the pen places every base glyph where the spread
/// laid it. Only adjacent, byte- and geometry-contiguous fragments inside
/// a single spread item merge; everything else passes through untouched.
pub(crate) fn merge_ruby_spread_fragments(
    children: &mut Vec<(Fragment, f64)>,
    item_ranges: &[std::ops::Range<usize>],
    ruby_spreads: &std::collections::HashMap<usize, f64>,
) {
    let mut merged: Vec<(Fragment, f64)> = Vec::with_capacity(children.len());
    for (fragment, shift) in children.drain(..) {
        let mergeable = match (&fragment, merged.last()) {
            (Fragment::Text(next), Some((Fragment::Text(previous), previous_shift))) => {
                next.text_start == previous.text_end
                    && *previous_shift == shift
                    && (next.rect.x - (previous.rect.x + previous.rect.width)).abs() < 0.5
                    && item_ranges.iter().enumerate().any(|(index, range)| {
                        ruby_spreads.contains_key(&index)
                            && range.start <= previous.text_start as usize
                            && next.text_end as usize <= range.end
                    })
            }
            _ => false,
        };
        if mergeable {
            if let (Fragment::Text(next), Some((Fragment::Text(previous), _))) =
                (&fragment, merged.last_mut())
            {
                let offset = next.rect.x - previous.rect.x;
                previous.rect.width = next.rect.x + next.rect.width - previous.rect.x;
                previous.text_end = next.text_end;
                previous
                    .clusters
                    .extend(next.clusters.iter().map(|cluster| ClusterPosition {
                        byte: cluster.byte,
                        x: cluster.x + offset,
                    }));
            }
            continue;
        }
        merged.push((fragment, shift));
    }
    *children = merged;
}
