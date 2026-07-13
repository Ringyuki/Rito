use super::{ExactRunShape, RunShapeCluster, RunShapeDirection};

pub(super) fn apply_spacing_delta(
    shape: &mut ExactRunShape,
    text: &str,
    word_spacing_delta: f64,
    letter_spacing_delta: f64,
) -> bool {
    let cluster_gaps = shape.clusters.len().saturating_sub(1);
    if letter_spacing_delta != 0.0 && text.chars().count().saturating_sub(1) != cluster_gaps {
        return false;
    }

    // Exact retained shapes have already been constrained to a complete,
    // direction-monotone UTF-16 grapheme partition. That lets each directional
    // cursor consume the source once without retaining another boundary table.
    match shape.direction {
        RunShapeDirection::LeftToRight => apply_left_to_right(
            &mut shape.clusters,
            text.chars(),
            cluster_gaps,
            word_spacing_delta,
            letter_spacing_delta,
        ),
        RunShapeDirection::RightToLeft => apply_right_to_left(
            &mut shape.clusters,
            text.chars().rev(),
            cluster_gaps,
            word_spacing_delta,
            letter_spacing_delta,
        ),
    }
    true
}

fn apply_left_to_right(
    clusters: &mut [RunShapeCluster],
    mut characters: impl Iterator<Item = char>,
    cluster_gaps: usize,
    word_spacing_delta: f64,
    letter_spacing_delta: f64,
) {
    let mut logical_cursor = 0usize;
    for (visual_index, cluster) in clusters.iter_mut().enumerate() {
        debug_assert_eq!(cluster.logical_start as usize, logical_cursor);
        let spaces = consume_forward(
            &mut characters,
            &mut logical_cursor,
            cluster.logical_end as usize,
        );
        update_cluster_advance(
            cluster,
            spaces,
            visual_index,
            cluster_gaps,
            word_spacing_delta,
            letter_spacing_delta,
        );
    }
    debug_assert!(characters.next().is_none());
}

fn apply_right_to_left(
    clusters: &mut [RunShapeCluster],
    mut characters: impl Iterator<Item = char>,
    cluster_gaps: usize,
    word_spacing_delta: f64,
    letter_spacing_delta: f64,
) {
    let mut logical_cursor = clusters
        .first()
        .map_or(0, |cluster| cluster.logical_end as usize);
    for (visual_index, cluster) in clusters.iter_mut().enumerate() {
        debug_assert_eq!(cluster.logical_end as usize, logical_cursor);
        let spaces = consume_backward(
            &mut characters,
            &mut logical_cursor,
            cluster.logical_start as usize,
        );
        update_cluster_advance(
            cluster,
            spaces,
            visual_index,
            cluster_gaps,
            word_spacing_delta,
            letter_spacing_delta,
        );
    }
    debug_assert_eq!(logical_cursor, 0);
    debug_assert!(characters.next().is_none());
}

fn consume_forward(
    characters: &mut impl Iterator<Item = char>,
    logical_cursor: &mut usize,
    logical_end: usize,
) -> usize {
    let mut spaces = 0usize;
    while *logical_cursor < logical_end {
        let Some(character) = characters.next() else {
            debug_assert!(false, "exact shape extends beyond its source text");
            break;
        };
        #[cfg(test)]
        record_scalar_visit();
        *logical_cursor += character.len_utf16();
        spaces += usize::from(character == ' ');
    }
    debug_assert_eq!(*logical_cursor, logical_end);
    spaces
}

fn consume_backward(
    characters: &mut impl Iterator<Item = char>,
    logical_cursor: &mut usize,
    logical_start: usize,
) -> usize {
    let mut spaces = 0usize;
    while *logical_cursor > logical_start {
        let Some(character) = characters.next() else {
            debug_assert!(false, "exact shape extends beyond its source text");
            break;
        };
        #[cfg(test)]
        record_scalar_visit();
        *logical_cursor = logical_cursor.saturating_sub(character.len_utf16());
        spaces += usize::from(character == ' ');
    }
    debug_assert_eq!(*logical_cursor, logical_start);
    spaces
}

fn update_cluster_advance(
    cluster: &mut RunShapeCluster,
    spaces: usize,
    visual_index: usize,
    cluster_gaps: usize,
    word_spacing_delta: f64,
    letter_spacing_delta: f64,
) {
    let mut advance = f64::from(cluster.advance);
    advance += spaces as f64 * word_spacing_delta;
    if visual_index < cluster_gaps {
        advance += letter_spacing_delta;
    }
    cluster.advance = advance as f32;
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
pub(super) fn reset_scalar_visits() {
    SCALAR_VISITS.set(0);
}

#[cfg(test)]
pub(super) fn scalar_visits() -> usize {
    SCALAR_VISITS.get()
}

#[cfg(test)]
mod tests;
