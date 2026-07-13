use unicode_segmentation::UnicodeSegmentation;

use crate::layout::text_shape::{RunShapeCluster, RunShapeDirection};

#[derive(Clone, Copy)]
struct LogicalRange {
    start: u32,
    end: u32,
}

struct GraphemeIndex {
    ends: Vec<u32>,
}

pub(super) fn constrain_clusters_to_graphemes(
    text: &str,
    clusters: Vec<RunShapeCluster>,
    direction: RunShapeDirection,
) -> Option<Vec<RunShapeCluster>> {
    if text.is_empty() {
        return clusters.is_empty().then_some(clusters);
    }
    let graphemes = GraphemeIndex::new(text)?;
    let mut constrained = Vec::<RunShapeCluster>::with_capacity(clusters.len());
    for cluster in clusters {
        let range = graphemes.enclosing_range(&cluster)?;
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
    validate_cluster_partition(&constrained, graphemes.text_end(), direction).then_some(constrained)
}

impl GraphemeIndex {
    fn new(text: &str) -> Option<Self> {
        let mut ends = Vec::new();
        let mut cursor = 0u32;
        for grapheme in text.graphemes(true) {
            let length = u32::try_from(grapheme.encode_utf16().count()).ok()?;
            let end = cursor.checked_add(length)?;
            #[cfg(test)]
            record_grapheme_entry();
            ends.push(end);
            cursor = end;
        }
        Some(Self { ends })
    }

    fn enclosing_range(&self, cluster: &RunShapeCluster) -> Option<LogicalRange> {
        if cluster.logical_start >= cluster.logical_end {
            return None;
        }
        let final_unit = cluster.logical_end.checked_sub(1)?;
        let first_owner = self.owner(cluster.logical_start)?;
        let last_owner = self.owner(final_unit)?;
        let start = first_owner
            .checked_sub(1)
            .map_or(0, |previous| self.ends[previous]);
        Some(LogicalRange {
            start,
            end: self.ends[last_owner],
        })
    }

    fn owner(&self, utf16_unit: u32) -> Option<usize> {
        #[cfg(test)]
        record_endpoint_lookup();
        let owner = self.ends.partition_point(|end| *end <= utf16_unit);
        (owner < self.ends.len()).then_some(owner)
    }

    fn text_end(&self) -> u32 {
        self.ends.last().copied().unwrap_or(0)
    }
}

fn ranges_overlap(left: &RunShapeCluster, right: &RunShapeCluster) -> bool {
    left.logical_start < right.logical_end && right.logical_start < left.logical_end
}

fn validate_cluster_partition(
    clusters: &[RunShapeCluster],
    text_end: u32,
    direction: RunShapeDirection,
) -> bool {
    let mut expected = match direction {
        RunShapeDirection::LeftToRight => 0,
        RunShapeDirection::RightToLeft => text_end,
    };
    for cluster in clusters {
        match direction {
            RunShapeDirection::LeftToRight if cluster.logical_start == expected => {
                expected = cluster.logical_end;
            }
            RunShapeDirection::RightToLeft if cluster.logical_end == expected => {
                expected = cluster.logical_start;
            }
            _ => return false,
        }
    }
    expected
        == match direction {
            RunShapeDirection::LeftToRight => text_end,
            RunShapeDirection::RightToLeft => 0,
        }
}

#[cfg(test)]
thread_local! {
    static GRAPHEME_ENTRIES: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    static ENDPOINT_LOOKUPS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn record_grapheme_entry() {
    GRAPHEME_ENTRIES.set(GRAPHEME_ENTRIES.get().saturating_add(1));
}

#[cfg(test)]
fn record_endpoint_lookup() {
    ENDPOINT_LOOKUPS.set(ENDPOINT_LOOKUPS.get().saturating_add(1));
}

#[cfg(test)]
fn reset_operation_counts() {
    GRAPHEME_ENTRIES.set(0);
    ENDPOINT_LOOKUPS.set(0);
}

#[cfg(test)]
fn operation_counts() -> (usize, usize) {
    (GRAPHEME_ENTRIES.get(), ENDPOINT_LOOKUPS.get())
}

#[cfg(test)]
mod tests {
    use super::{constrain_clusters_to_graphemes, operation_counts, reset_operation_counts};
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

    #[test]
    fn preserves_utf16_interior_endpoint_compatibility() {
        let constrained = constrain_clusters_to_graphemes(
            "😀",
            vec![cluster(1, 2, 4.0)],
            RunShapeDirection::LeftToRight,
        )
        .expect("UTF-16 interior offsets expand to the enclosing grapheme");

        assert_eq!(
            constrained
                .iter()
                .map(|cluster| (cluster.logical_start, cluster.logical_end))
                .collect::<Vec<_>>(),
            [(0, 2)]
        );
    }

    #[test]
    fn keeps_adjacent_merge_rounding_in_visual_order() {
        let constrained = constrain_clusters_to_graphemes(
            "a\u{301}\u{301}",
            vec![
                cluster(0, 1, 16_777_216.0),
                cluster(1, 2, 1.0),
                cluster(2, 3, 1.0),
            ],
            RunShapeDirection::LeftToRight,
        )
        .expect("adjacent fragments merge into their shared grapheme");

        assert_eq!(constrained.len(), 1);
        assert_eq!(constrained[0].advance.to_bits(), 16_777_216.0_f32.to_bits());
    }

    #[test]
    fn indexes_graphemes_and_cluster_endpoints_once_in_both_directions() {
        const CLUSTER_COUNT: usize = 10_000;
        let text = "a".repeat(CLUSTER_COUNT);

        for direction in [
            RunShapeDirection::LeftToRight,
            RunShapeDirection::RightToLeft,
        ] {
            let offsets: Box<dyn Iterator<Item = usize>> = match direction {
                RunShapeDirection::LeftToRight => Box::new(0..CLUSTER_COUNT),
                RunShapeDirection::RightToLeft => Box::new((0..CLUSTER_COUNT).rev()),
            };
            let clusters = offsets
                .map(|offset| cluster(offset as u32, offset as u32 + 1, 1.0))
                .collect();

            reset_operation_counts();
            let constrained = constrain_clusters_to_graphemes(&text, clusters, direction)
                .expect("one-scalar clusters form a complete partition");

            assert_eq!(constrained.len(), CLUSTER_COUNT);
            assert_eq!(operation_counts(), (CLUSTER_COUNT, CLUSTER_COUNT * 2));
        }
    }

    #[test]
    fn a_long_single_grapheme_retains_only_one_index_entry() {
        const COMBINING_MARKS: usize = 10_000;
        let text = format!("a{}", "\u{301}".repeat(COMBINING_MARKS));

        reset_operation_counts();
        let constrained = constrain_clusters_to_graphemes(
            &text,
            vec![cluster(0, COMBINING_MARKS as u32 + 1, 1.0)],
            RunShapeDirection::LeftToRight,
        )
        .expect("one long grapheme remains a valid cluster");

        assert_eq!(constrained.len(), 1);
        assert_eq!(operation_counts(), (1, 2));
    }

    fn cluster(logical_start: u32, logical_end: u32, advance: f32) -> RunShapeCluster {
        RunShapeCluster {
            logical_start,
            logical_end,
            advance,
        }
    }
}

#[cfg(test)]
mod parity_tests;
