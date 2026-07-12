use unicode_segmentation::UnicodeSegmentation;

use crate::layout::text_shape::{RunShapeCluster, RunShapeDirection};

#[derive(Clone, Copy)]
struct LogicalRange {
    start: u32,
    end: u32,
}

pub(super) fn constrain_clusters_to_graphemes(
    text: &str,
    clusters: Vec<RunShapeCluster>,
    direction: RunShapeDirection,
) -> Option<Vec<RunShapeCluster>> {
    if text.is_empty() {
        return clusters.is_empty().then_some(clusters);
    }
    let graphemes = grapheme_ranges(text)?;
    let mut constrained = Vec::<RunShapeCluster>::with_capacity(clusters.len());
    for cluster in clusters {
        let range = enclosing_grapheme_range(&graphemes, &cluster)?;
        let expanded = RunShapeCluster {
            logical_start: range.start,
            logical_end: range.end,
            advance: cluster.advance,
        };
        if let Some(previous) = constrained.last_mut() {
            if ranges_overlap(previous, &expanded) {
                previous.logical_start = previous.logical_start.min(expanded.logical_start);
                previous.logical_end = previous.logical_end.max(expanded.logical_end);
                previous.advance =
                    (f64::from(previous.advance) + f64::from(expanded.advance)) as f32;
                continue;
            }
        }
        constrained.push(expanded);
    }
    validate_cluster_partition(&constrained, &graphemes, direction).then_some(constrained)
}

fn grapheme_ranges(text: &str) -> Option<Vec<LogicalRange>> {
    let mut ranges = Vec::new();
    let mut cursor = 0_u32;
    for grapheme in text.graphemes(true) {
        let length = u32::try_from(grapheme.encode_utf16().count()).ok()?;
        let end = cursor.checked_add(length)?;
        ranges.push(LogicalRange { start: cursor, end });
        cursor = end;
    }
    Some(ranges)
}

fn enclosing_grapheme_range(
    graphemes: &[LogicalRange],
    cluster: &RunShapeCluster,
) -> Option<LogicalRange> {
    if cluster.logical_start >= cluster.logical_end {
        return None;
    }
    let first = graphemes
        .iter()
        .find(|range| range.start <= cluster.logical_start && cluster.logical_start < range.end)?;
    let last = graphemes
        .iter()
        .find(|range| range.start < cluster.logical_end && cluster.logical_end <= range.end)?;
    Some(LogicalRange {
        start: first.start,
        end: last.end,
    })
}

fn ranges_overlap(left: &RunShapeCluster, right: &RunShapeCluster) -> bool {
    left.logical_start < right.logical_end && right.logical_start < left.logical_end
}

fn validate_cluster_partition(
    clusters: &[RunShapeCluster],
    graphemes: &[LogicalRange],
    direction: RunShapeDirection,
) -> bool {
    let Some(first_grapheme) = graphemes.first() else {
        return clusters.is_empty();
    };
    let Some(last_grapheme) = graphemes.last() else {
        return false;
    };
    let mut logical_ranges = clusters
        .iter()
        .map(|cluster| (cluster.logical_start, cluster.logical_end))
        .collect::<Vec<_>>();
    logical_ranges.sort_unstable();
    if logical_ranges.first().map(|range| range.0) != Some(first_grapheme.start)
        || logical_ranges.last().map(|range| range.1) != Some(last_grapheme.end)
        || logical_ranges.windows(2).any(|pair| pair[0].1 != pair[1].0)
    {
        return false;
    }
    clusters.windows(2).all(|pair| match direction {
        RunShapeDirection::LeftToRight => pair[0].logical_end <= pair[1].logical_start,
        RunShapeDirection::RightToLeft => pair[1].logical_end <= pair[0].logical_start,
    })
}

#[cfg(test)]
mod tests {
    use super::constrain_clusters_to_graphemes;
    use crate::layout::text_shape::{RunShapeCluster, RunShapeDirection};

    #[test]
    fn merges_visually_adjacent_clusters_inside_a_devanagari_zwnj_grapheme() {
        let clusters = vec![cluster(0, 2, 10.0), cluster(2, 3, 0.0), cluster(3, 4, 12.0)];

        let constrained =
            constrain_clusters_to_graphemes("क्‌ष", clusters, RunShapeDirection::LeftToRight)
                .expect("visual clusters can be merged at EGC boundaries");

        assert_eq!(
            constrained
                .iter()
                .map(|cluster| (cluster.logical_start, cluster.logical_end, cluster.advance))
                .collect::<Vec<_>>(),
            [(0, 3, 10.0), (3, 4, 12.0)]
        );
    }

    #[test]
    fn rejects_non_adjacent_visual_clusters_from_the_same_grapheme() {
        let clusters = vec![cluster(0, 1, 5.0), cluster(2, 3, 7.0), cluster(1, 2, 6.0)];

        assert!(constrain_clusters_to_graphemes(
            "a\u{301}b",
            clusters,
            RunShapeDirection::LeftToRight,
        )
        .is_none());
    }

    fn cluster(logical_start: u32, logical_end: u32, advance: f32) -> RunShapeCluster {
        RunShapeCluster {
            logical_start,
            logical_end,
            advance,
        }
    }
}
