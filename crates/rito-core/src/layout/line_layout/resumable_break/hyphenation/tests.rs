use std::num::NonZeroUsize;

use crate::layout::{
    line_break::{try_ascii_hyphenation, utf16_len, LineBreakOptions, Utf16Text},
    text_work::{TextWorkBudget, TextWorkMeter},
};

use super::{PendingAsciiHyphenation, PendingHyphenationAdvance, TextWorkYield};

#[test]
fn tiny_quanta_preserve_long_word_candidate_order_without_livelock() {
    let source = "Nokyoushitsue".repeat(32);
    let text = Utf16Text::new(&source);
    let fit_pos = text.len - 2;
    let (expected, expected_candidates) = eager_all_fail(&text, 0, fit_pos);
    let (actual, actual_candidates, quantum_count, pending) = drive_all_fail(&text, 0, fit_pos, 8);

    assert!(quantum_count > 50);
    assert_eq!(actual, expected);
    assert_eq!(actual_candidates, expected_candidates);
    assert_eq!(pending.point_generation_count(), 1);
    assert_cached_result(&text, pending, expected);
}

#[test]
fn one_unit_quanta_preserve_absolute_offsets_across_astral_word_edges() {
    let source = "前😀Nokyoushitsue界";
    let text = Utf16Text::new(source);
    let line_start = utf16_len("前");
    let word_start = utf16_len("前😀");
    let fit_pos = word_start + 11;
    let (expected, expected_candidates) = eager_all_fail(&text, line_start, fit_pos);
    let (actual, actual_candidates, quantum_count, pending) =
        drive_all_fail(&text, line_start, fit_pos, 1);

    assert!(quantum_count > source.encode_utf16().count());
    assert_eq!(actual, expected);
    assert_eq!(actual_candidates, expected_candidates);
    assert!(actual_candidates
        .iter()
        .all(|candidate| *candidate >= word_start));
    assert_eq!(pending.point_generation_count(), 1);
}

#[test]
fn pending_candidate_and_completed_result_replay_without_spending_work() {
    let text = Utf16Text::new("Nokyoushitsue");
    let mut pending = PendingAsciiHyphenation::new(0, 11);
    let candidate = match pending
        .advance(&text, &mut unbounded_meter())
        .expect("hyphen preparation completes")
    {
        PendingHyphenationAdvance::Candidate(candidate) => candidate,
        PendingHyphenationAdvance::Complete(_) => panic!("a candidate is expected"),
    };

    let mut replay_work = tiny_meter(1);
    assert_eq!(
        pending.advance(&text, &mut replay_work),
        Ok(PendingHyphenationAdvance::Candidate(candidate))
    );
    assert_eq!(replay_work.utf16_units_remaining(), 1);
    assert_eq!(pending.point_generation_count(), 1);

    pending.resolve_candidate(candidate, true);
    assert_eq!(replay_work.take_utf16_units(1), 1);
    assert_eq!(
        pending.advance(&text, &mut replay_work),
        Ok(PendingHyphenationAdvance::Complete(Some(candidate)))
    );
    assert_eq!(pending.point_generation_count(), 1);
}

#[test]
fn ineligible_empty_range_completes_without_spending_work() {
    let text = Utf16Text::new("word");
    let mut pending = PendingAsciiHyphenation::new(2, 2);
    let mut work = tiny_meter(1);

    assert_eq!(
        pending.advance(&text, &mut work),
        Ok(PendingHyphenationAdvance::Complete(None))
    );
    assert_eq!(work.utf16_units_remaining(), 1);
    assert_eq!(pending.point_generation_count(), 0);
}

fn eager_all_fail(
    text: &Utf16Text<'_>,
    line_start: usize,
    fit_pos: usize,
) -> (Option<usize>, Vec<usize>) {
    let mut candidates = Vec::new();
    let result = try_ascii_hyphenation(
        text,
        line_start,
        fit_pos,
        &LineBreakOptions::default(),
        |candidate| {
            candidates.push(candidate);
            false
        },
    );
    (result, candidates)
}

fn drive_all_fail<'a>(
    text: &Utf16Text<'a>,
    line_start: usize,
    fit_pos: usize,
    quantum_utf16_units: usize,
) -> (Option<usize>, Vec<usize>, usize, PendingAsciiHyphenation) {
    let mut pending = PendingAsciiHyphenation::new(line_start, fit_pos);
    let mut candidates = Vec::new();
    let mut quantum_count = 0;
    let result = 'quanta: loop {
        quantum_count += 1;
        assert!(quantum_count < 10_000, "hyphenation must not livelock");
        let mut work = tiny_meter(quantum_utf16_units);
        loop {
            match pending.advance(text, &mut work) {
                Ok(PendingHyphenationAdvance::Candidate(candidate)) => {
                    candidates.push(candidate);
                    pending.resolve_candidate(candidate, false);
                }
                Ok(PendingHyphenationAdvance::Complete(result)) => break 'quanta result,
                Err(TextWorkYield) => break,
            }
        }
    };
    (result, candidates, quantum_count, pending)
}

fn assert_cached_result(
    text: &Utf16Text<'_>,
    mut pending: PendingAsciiHyphenation,
    expected: Option<usize>,
) {
    let mut work = tiny_meter(1);
    assert_eq!(work.take_utf16_units(1), 1);
    assert_eq!(
        pending.advance(text, &mut work),
        Ok(PendingHyphenationAdvance::Complete(expected))
    );
    assert_eq!(pending.point_generation_count(), 1);
}

fn tiny_meter(max_utf16_units: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(max_utf16_units).expect("text limit is non-zero"),
        NonZeroUsize::new(1).expect("operation limit is non-zero"),
    ))
}

fn unbounded_meter() -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(NonZeroUsize::MAX, NonZeroUsize::MAX))
}
