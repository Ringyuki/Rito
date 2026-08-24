use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct LogicalClusterRange {
    pub(super) start: u32,
    pub(super) end: u32,
}

pub(super) fn logical_cluster_ranges(
    text: &str,
    infos: &[rustybuzz::GlyphInfo],
) -> Option<BTreeMap<u32, LogicalClusterRange>> {
    let mut starts = infos.iter().map(|info| info.cluster).collect::<Vec<_>>();
    starts.sort_unstable();
    starts.dedup();
    if starts.is_empty() {
        return Some(BTreeMap::new());
    }
    let text_end = u32::try_from(text.len()).ok()?;
    if starts.last().is_some_and(|start| *start > text_end) {
        return None;
    }

    let mut boundaries = starts.clone();
    if boundaries.last().copied() != Some(text_end) {
        boundaries.push(text_end);
    }
    let offsets = utf16_offsets_at(text, &boundaries)?;
    let mut ranges = BTreeMap::new();
    for (index, start) in starts.iter().copied().enumerate() {
        let end_index = (index + 1).min(offsets.len().saturating_sub(1));
        ranges.insert(
            start,
            LogicalClusterRange {
                start: offsets[index],
                end: offsets[end_index],
            },
        );
    }
    Some(ranges)
}

fn utf16_offsets_at(text: &str, boundaries: &[u32]) -> Option<Vec<u32>> {
    let text_end = u32::try_from(text.len()).ok()?;
    let mut offsets = Vec::with_capacity(boundaries.len());
    let mut boundary_index = 0usize;
    let mut utf16_offset = 0u32;
    for (byte_offset, character) in text.char_indices() {
        let byte_offset = u32::try_from(byte_offset).ok()?;
        if boundaries.get(boundary_index).copied() == Some(byte_offset) {
            offsets.push(utf16_offset);
            boundary_index += 1;
        } else if boundaries
            .get(boundary_index)
            .is_some_and(|boundary| *boundary < byte_offset)
        {
            return None;
        }
        #[cfg(test)]
        record_scalar_visit();
        utf16_offset = utf16_offset.checked_add(character.len_utf16() as u32)?;
    }
    if boundaries.get(boundary_index).copied() == Some(text_end) {
        offsets.push(utf16_offset);
        boundary_index += 1;
    }
    (boundary_index == boundaries.len()).then_some(offsets)
}

#[cfg(test)]
std::thread_local! {
    static SCALAR_VISITS: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
}

#[cfg(test)]
fn record_scalar_visit() {
    SCALAR_VISITS.set(SCALAR_VISITS.get().saturating_add(1));
}

#[cfg(test)]
fn reset_scalar_visits() {
    SCALAR_VISITS.set(0);
}

#[cfg(test)]
fn scalar_visits() -> usize {
    SCALAR_VISITS.get()
}

#[cfg(test)]
mod tests {
    use super::{logical_cluster_ranges, reset_scalar_visits, scalar_visits};

    #[test]
    fn maps_utf8_cluster_bytes_to_utf16_ranges() {
        let infos = infos(&[0, 1, 5]);

        let ranges = logical_cluster_ranges("a😀b", &infos).expect("all starts are boundaries");

        assert_eq!(
            ranges
                .values()
                .map(|range| (range.start, range.end))
                .collect::<Vec<_>>(),
            [(0, 1), (1, 3), (3, 4)]
        );
    }

    #[test]
    fn accepts_visual_right_to_left_order_without_changing_logical_ranges() {
        let infos = infos(&[4, 2, 0]);

        let ranges = logical_cluster_ranges("אבג", &infos).expect("all starts are boundaries");

        assert_eq!(
            ranges
                .values()
                .map(|range| (range.start, range.end))
                .collect::<Vec<_>>(),
            [(0, 1), (1, 2), (2, 3)]
        );
    }

    #[test]
    fn rejects_a_cluster_inside_a_utf8_scalar() {
        assert!(logical_cluster_ranges("😀", &infos(&[2])).is_none());
    }

    #[test]
    fn scans_each_scalar_once_for_many_clusters() {
        const SCALAR_COUNT: usize = 10_000;
        let text = "a".repeat(SCALAR_COUNT);
        let starts = (0..SCALAR_COUNT as u32).collect::<Vec<_>>();

        for starts in [starts.clone(), starts.into_iter().rev().collect()] {
            reset_scalar_visits();
            let ranges =
                logical_cluster_ranges(&text, &infos(&starts)).expect("ASCII boundaries map");

            assert_eq!(ranges.len(), SCALAR_COUNT);
            assert_eq!(scalar_visits(), SCALAR_COUNT);
        }
    }

    fn infos(starts: &[u32]) -> Vec<rustybuzz::GlyphInfo> {
        starts
            .iter()
            .map(|start| {
                let mut info = rustybuzz::GlyphInfo::default();
                info.cluster = *start;
                info
            })
            .collect()
    }
}
