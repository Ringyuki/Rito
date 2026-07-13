use std::num::NonZeroUsize;

use unicode_segmentation::UnicodeSegmentation;

use super::{GraphemeScanEvent, PendingGraphemeScan};
use crate::layout::text_work::{TextWorkBudget, TextWorkMeter, TextWorkYield};

#[test]
fn matches_extended_grapheme_oracle_across_adversarial_sequences() {
    let cases = [
        ("", 0),
        ("ascii", 5),
        ("\u{4e2d}e\u{301}", 2),
        ("\u{4e2d}\u{8fbb}\u{e0100}", 2),
        ("\u{4e2d}\u{1f469}\u{200d}\u{1f4bb}", 2),
        ("\u{4e2d}\u{1f44d}\u{1f3fd}", 2),
        ("\u{4e2d}1\u{fe0f}\u{20e3}", 2),
        ("\u{1f1e6}\u{1f1e7}\u{1f1e8}\u{1f1e9}\u{1f1ea}", 3),
        ("\u{1f1e6}\u{1f1e7}\u{1f1e8}\u{1f1e9}\u{1f1ea}\u{1f1eb}", 3),
        ("\r\n", 1),
        ("\rA", 2),
        ("\u{1100}\u{1161}\u{11a8}", 1),
        ("\u{1100}A", 2),
        ("\u{915}\u{94d}\u{937}", 1),
        ("\u{915}\u{937}", 2),
        ("\u{1f469}\u{301}\u{200d}\u{1f4bb}", 1),
        ("\u{1f469}\u{200d}A", 2),
        ("\u{600}\u{4e2d}", 1),
        ("a\u{0}b", 3),
    ];

    for (text, expected_count) in cases {
        assert_eq!(
            text.graphemes(true).count(),
            expected_count,
            "text={text:?}"
        );
        for quantum in [1, 2, 3, usize::MAX] {
            let (scalars, grapheme_count, _) = scan_with_quantum(text, quantum);
            assert_eq!(scalars, text.chars().collect::<Vec<_>>(), "text={text:?}");
            assert_eq!(grapheme_count, expected_count, "text={text:?}");
        }
    }
}

#[test]
fn one_unit_quanta_finish_long_combining_and_emoji_graphemes() {
    for (text, expected_count) in [
        (format!("\u{4e2d}{}", "\u{301}".repeat(10_000)), 1),
        (
            format!("\u{4e2d}{}\u{1f4bb}", "\u{1f469}\u{200d}".repeat(5_000)),
            2,
        ),
    ] {
        let utf16_len = text.encode_utf16().count();
        let (scalars, grapheme_count, yields) = scan_with_quantum(&text, 1);

        assert_eq!(scalars, text.chars().collect::<Vec<_>>());
        assert_eq!(grapheme_count, expected_count);
        assert!(
            yields <= utf16_len.saturating_mul(3).saturating_add(20),
            "one-unit scanning must make bounded progress"
        );
    }
}

#[test]
fn astral_source_is_reported_only_after_its_full_utf16_charge() {
    let mut scan = PendingGraphemeScan::new("\u{1f600}".len());
    let mut first = meter(1);
    assert_eq!(scan.advance("\u{1f600}", &mut first), Err(TextWorkYield));

    let mut second = meter(1);
    assert_eq!(
        scan.advance("\u{1f600}", &mut second),
        Ok(GraphemeScanEvent::Scalar('\u{1f600}'))
    );
}

fn scan_with_quantum(text: &str, quantum: usize) -> (Vec<char>, usize, usize) {
    let mut scan = PendingGraphemeScan::new(text.len());
    let mut scalars = Vec::new();
    let mut yields = 0usize;
    let max_steps = text
        .encode_utf16()
        .count()
        .saturating_mul(6)
        .saturating_add(20);

    for _ in 0..max_steps {
        let mut work = meter(quantum);
        match scan.advance(text, &mut work) {
            Ok(GraphemeScanEvent::Scalar(character)) => scalars.push(character),
            Ok(GraphemeScanEvent::Complete { grapheme_count }) => {
                return (scalars, grapheme_count, yields);
            }
            Err(TextWorkYield) => yields += 1,
        }
    }
    panic!("grapheme scan did not complete within its progress bound");
}

fn meter(max_utf16_units: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(max_utf16_units).expect("text limit is non-zero"),
        NonZeroUsize::new(1).expect("operation limit is non-zero"),
    ))
}
