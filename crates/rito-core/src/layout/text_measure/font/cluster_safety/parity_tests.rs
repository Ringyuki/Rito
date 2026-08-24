use unicode_segmentation::UnicodeSegmentation;

use super::constrain_clusters_to_graphemes;
use crate::layout::text_shape::{RunShapeCluster, RunShapeDirection};

#[derive(Clone, Copy)]
struct ReferenceRange {
    start: u32,
    end: u32,
}

#[test]
fn owner_index_matches_the_previous_range_scan_for_small_inputs() {
    for text in ["a\u{301}b", "😀a"] {
        let text_end = text.encode_utf16().count() as u32;
        let candidates = (0..=text_end)
            .flat_map(|start| (0..=text_end).map(move |end| (start, end)))
            .collect::<Vec<_>>();
        let mut sequences = Vec::new();
        for length in 0..=3 {
            append_sequences(&candidates, length, &mut Vec::new(), &mut sequences);
        }

        for direction in [
            RunShapeDirection::LeftToRight,
            RunShapeDirection::RightToLeft,
        ] {
            for sequence in &sequences {
                let actual = constrain_clusters_to_graphemes(text, clusters(sequence), direction);
                let expected = reference_constrain(text, clusters(sequence), direction);
                assert_clusters_bit_eq(actual.as_deref(), expected.as_deref(), sequence);
            }
        }
    }
}

#[test]
fn owner_index_preserves_out_of_range_rejection() {
    for direction in [
        RunShapeDirection::LeftToRight,
        RunShapeDirection::RightToLeft,
    ] {
        let sequence = [(0, u32::MAX)];
        let actual = constrain_clusters_to_graphemes("a", clusters(&sequence), direction);
        let expected = reference_constrain("a", clusters(&sequence), direction);

        assert_clusters_bit_eq(actual.as_deref(), expected.as_deref(), &sequence);
    }
}

fn append_sequences(
    candidates: &[(u32, u32)],
    remaining: usize,
    current: &mut Vec<(u32, u32)>,
    output: &mut Vec<Vec<(u32, u32)>>,
) {
    if remaining == 0 {
        output.push(current.clone());
        return;
    }
    for candidate in candidates {
        current.push(*candidate);
        append_sequences(candidates, remaining - 1, current, output);
        current.pop();
    }
}

fn clusters(ranges: &[(u32, u32)]) -> Vec<RunShapeCluster> {
    const ADVANCES: [f32; 3] = [16_777_216.0, 1.0, 1.0];
    ranges
        .iter()
        .enumerate()
        .map(|(index, range)| RunShapeCluster {
            logical_start: range.0,
            logical_end: range.1,
            advance: ADVANCES[index],
        })
        .collect()
}

fn reference_constrain(
    text: &str,
    clusters: Vec<RunShapeCluster>,
    direction: RunShapeDirection,
) -> Option<Vec<RunShapeCluster>> {
    if text.is_empty() {
        return clusters.is_empty().then_some(clusters);
    }
    let graphemes = reference_grapheme_ranges(text)?;
    let mut constrained = Vec::<RunShapeCluster>::with_capacity(clusters.len());
    for cluster in clusters {
        let range = reference_enclosing_range(&graphemes, &cluster)?;
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
    reference_validate(&constrained, &graphemes, direction).then_some(constrained)
}

fn reference_grapheme_ranges(text: &str) -> Option<Vec<ReferenceRange>> {
    let mut ranges = Vec::new();
    let mut cursor = 0u32;
    for grapheme in text.graphemes(true) {
        let length = u32::try_from(grapheme.encode_utf16().count()).ok()?;
        let end = cursor.checked_add(length)?;
        ranges.push(ReferenceRange { start: cursor, end });
        cursor = end;
    }
    Some(ranges)
}

fn reference_enclosing_range(
    graphemes: &[ReferenceRange],
    cluster: &RunShapeCluster,
) -> Option<ReferenceRange> {
    if cluster.logical_start >= cluster.logical_end {
        return None;
    }
    let first = graphemes
        .iter()
        .find(|range| range.start <= cluster.logical_start && cluster.logical_start < range.end)?;
    let last = graphemes
        .iter()
        .find(|range| range.start < cluster.logical_end && cluster.logical_end <= range.end)?;
    Some(ReferenceRange {
        start: first.start,
        end: last.end,
    })
}

fn reference_validate(
    clusters: &[RunShapeCluster],
    graphemes: &[ReferenceRange],
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

fn ranges_overlap(left: &RunShapeCluster, right: &RunShapeCluster) -> bool {
    left.logical_start < right.logical_end && right.logical_start < left.logical_end
}

fn assert_clusters_bit_eq(
    actual: Option<&[RunShapeCluster]>,
    expected: Option<&[RunShapeCluster]>,
    input: &[(u32, u32)],
) {
    match (actual, expected) {
        (Some(actual), Some(expected)) => {
            assert_eq!(actual.len(), expected.len(), "input: {input:?}");
            for (actual, expected) in actual.iter().zip(expected) {
                assert_eq!(
                    actual.logical_start, expected.logical_start,
                    "input: {input:?}"
                );
                assert_eq!(actual.logical_end, expected.logical_end, "input: {input:?}");
                assert_eq!(
                    actual.advance.to_bits(),
                    expected.advance.to_bits(),
                    "input: {input:?}"
                );
            }
        }
        (None, None) => {}
        _ => panic!("availability differs for input: {input:?}"),
    }
}
