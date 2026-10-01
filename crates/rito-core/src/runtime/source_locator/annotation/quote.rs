//! Quote matching over UTF-16 units: every occurrence of the quoted text,
//! ranked by how much of the stored context surrounds it.

use super::{is_high_surrogate, is_low_surrogate};

/// The start of the occurrence whose surroundings best match `prefix` and
/// `suffix`; the first one on a tie.
pub(super) fn best_quote_match(
    text: &[u16],
    exact: &[u16],
    prefix: &[u16],
    suffix: &[u16],
) -> Option<usize> {
    if exact.is_empty() || exact.len() > text.len() {
        return None;
    }
    let mut best: Option<(usize, usize)> = None;
    for start in 0..=text.len() - exact.len() {
        if text[start..start + exact.len()] != *exact {
            continue;
        }
        let score = context_score(text, start, start + exact.len(), prefix, suffix);
        if best.is_none_or(|(_, best_score)| score > best_score) {
            best = Some((start, score));
        }
    }
    best.map(|(start, _)| start)
}

fn context_score(text: &[u16], start: usize, end: usize, prefix: &[u16], suffix: &[u16]) -> usize {
    let before = &text[start.saturating_sub(prefix.len())..start];
    let after = &text[end..(end + suffix.len()).min(text.len())];
    let shared_prefix = before
        .iter()
        .rev()
        .zip(prefix.iter().rev())
        .take_while(|(a, b)| a == b)
        .count();
    let shared_suffix = after.iter().zip(suffix).take_while(|(a, b)| a == b).count();
    shared_prefix + shared_suffix
}

/// Where up to `units` of context before `start` begins, moved forward off
/// the second half of a surrogate pair.
pub(super) fn context_start(text: &[u16], start: usize, units: usize) -> usize {
    let begin = start.saturating_sub(units);
    if begin < start && is_low_surrogate(text[begin]) {
        begin + 1
    } else {
        begin
    }
}

/// Where up to `units` of context after `end` stops, moved back off the
/// first half of a surrogate pair.
pub(super) fn context_end(text: &[u16], end: usize, units: usize) -> usize {
    let stop = (end + units).min(text.len());
    if stop > end && stop < text.len() && is_high_surrogate(text[stop - 1]) {
        stop - 1
    } else {
        stop
    }
}
