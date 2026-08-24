use std::num::NonZeroUsize;

use unicode_segmentation::UnicodeSegmentation;

use super::{GraphemeScanEvent, PendingGraphemeBoundaryComparator, PendingGraphemeScan};
use crate::layout::{
    text_mapping::text_transform_is_linear,
    text_work::{TextWorkBudget, TextWorkMeter, TextWorkYield},
};

#[test]
fn scan_matches_extended_grapheme_oracle_at_tiny_quanta() {
    let cases = [
        "",
        "ascii",
        "\u{4e2d}e\u{301}",
        "\u{4e2d}\u{8fbb}\u{e0100}",
        "\u{4e2d}\u{1f469}\u{200d}\u{1f4bb}",
        "\u{4e2d}\u{1f44d}\u{1f3fd}",
        "\u{4e2d}1\u{fe0f}\u{20e3}",
        "\u{1f1e6}\u{1f1e7}\u{1f1e8}\u{1f1e9}\u{1f1ea}",
        "\u{1f1e6}\u{1f1e7}\u{1f1e8}\u{1f1e9}\u{1f1ea}\u{1f1eb}",
        "\r\n",
        "\rA",
        "\u{1100}\u{1161}\u{11a8}",
        "\u{1100}A",
        "\u{915}\u{94d}\u{937}",
        "\u{915}\u{937}",
        "\u{1f469}\u{301}\u{200d}\u{1f4bb}",
        "\u{1f469}\u{200d}A",
        "\u{600}\u{4e2d}",
        "a\u{0}b",
    ];

    for text in cases {
        let expected = grapheme_boundaries(text);
        for quantum in [1, 2, 3, usize::MAX] {
            let (scalars, boundaries, grapheme_count, _) = scan_with_quantum(text, quantum);
            assert_eq!(scalars, text.chars().collect::<Vec<_>>(), "text={text:?}");
            assert_eq!(boundaries, expected, "text={text:?}");
            assert_eq!(grapheme_count, expected.len(), "text={text:?}");
        }
    }
}

#[test]
fn comparator_matches_eager_oracle_at_tiny_quanta() {
    let cases = [
        ("", ""),
        ("", "a"),
        ("a", ""),
        ("hello", "HELLO"),
        ("\u{212a}", "k"),
        ("\u{10400}", "\u{10428}"),
        ("\u{1f600}", "a\u{301}"),
        ("a\u{301}b", "ab\u{301}"),
        ("\r\n", "ab"),
        ("\u{20}a", "a\u{20}"),
    ];

    for (logical, display) in cases {
        let expected_graphemes = grapheme_boundaries(logical) == grapheme_boundaries(display);
        let expected_linear = text_transform_is_linear(logical, display);
        for quantum in [1, 2, 3, usize::MAX] {
            let actual_graphemes = compare_with_quantum(logical, display, quantum);
            assert_eq!(
                actual_graphemes, expected_graphemes,
                "logical={logical:?}, display={display:?}, quantum={quantum}"
            );
            assert_eq!(
                scalar_boundaries(logical) == scalar_boundaries(display) && actual_graphemes,
                expected_linear,
                "combined scalar/grapheme decision must match the eager oracle"
            );
        }
    }
}

#[test]
fn final_grapheme_boundary_is_emitted_exactly_once() {
    for text in ["a", "\u{1f600}", "a\u{301}", "\r\n"] {
        let (_, boundaries, count, _) = scan_with_quantum(text, 1);
        let final_offset = text.encode_utf16().count();
        assert_eq!(boundaries.last(), Some(&final_offset), "text={text:?}");
        assert_eq!(
            boundaries
                .iter()
                .filter(|&&offset| offset == final_offset)
                .count(),
            1,
            "text={text:?}"
        );
        assert_eq!(count, boundaries.len());
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
        let (scalars, boundaries, grapheme_count, yields) = scan_with_quantum(&text, 1);

        assert_eq!(scalars, text.chars().collect::<Vec<_>>());
        assert_eq!(boundaries, grapheme_boundaries(&text));
        assert_eq!(grapheme_count, expected_count);
        assert!(
            yields <= utf16_len.saturating_mul(3).saturating_add(20),
            "one-unit scanning must make bounded progress"
        );
    }
}

#[test]
fn comparator_does_not_consume_an_atomic_operation() {
    let logical = "a\u{301}b";
    let display = "A\u{301}B";
    let mut comparison = PendingGraphemeBoundaryComparator::new(logical.len(), display.len());
    let mut work = meter(usize::MAX);

    assert_eq!(comparison.advance(logical, display, &mut work), Ok(true));
    assert_eq!(work.atomic_operations_remaining(), 1);
}

#[test]
fn one_unit_quanta_finish_long_contextual_sequences() {
    let cases = [
        format!("a{}", "\u{301}".repeat(10_000)),
        format!("{}\u{1f4bb}", "\u{1f469}\u{200d}".repeat(5_000)),
        "\u{1f1e6}\u{1f1e7}".repeat(5_000),
        "\r\n".repeat(10_000),
        "\u{10400}".repeat(10_000),
    ];

    for logical in cases {
        let display = logical.to_uppercase();
        let actual_graphemes = compare_with_quantum(&logical, &display, 1);
        assert_eq!(
            scalar_boundaries(&logical) == scalar_boundaries(&display) && actual_graphemes,
            text_transform_is_linear(&logical, &display),
            "long comparison must match the eager oracle"
        );
    }
}

#[test]
fn astral_scalar_is_reported_only_after_its_full_utf16_charge() {
    let mut scan = PendingGraphemeScan::new("\u{1f600}".len());
    let mut first = meter(1);
    assert_eq!(scan.advance("\u{1f600}", &mut first), Err(TextWorkYield));

    let mut second = meter(1);
    assert_eq!(
        scan.advance("\u{1f600}", &mut second),
        Ok(GraphemeScanEvent::Scalar('\u{1f600}'))
    );
}

fn compare_with_quantum(logical: &str, display: &str, quantum: usize) -> bool {
    let mut comparison = PendingGraphemeBoundaryComparator::new(logical.len(), display.len());
    let mut yields = 0usize;
    let max_yields = logical
        .encode_utf16()
        .count()
        .saturating_add(display.encode_utf16().count())
        .saturating_mul(8)
        .saturating_add(20);
    loop {
        let mut work = meter(quantum);
        match comparison.advance(logical, display, &mut work) {
            Ok(result) => return result,
            Err(TextWorkYield) => yields += 1,
        }
        assert!(
            yields <= max_yields,
            "comparison exceeded its progress bound"
        );
    }
}

fn scan_with_quantum(text: &str, quantum: usize) -> (Vec<char>, Vec<usize>, usize, usize) {
    let mut scan = PendingGraphemeScan::new(text.len());
    let mut scalars = Vec::new();
    let mut boundaries = Vec::new();
    let mut yields = 0usize;
    let max_steps = text
        .encode_utf16()
        .count()
        .saturating_mul(8)
        .saturating_add(20);
    for _ in 0..max_steps {
        let mut work = meter(quantum);
        match scan.advance(text, &mut work) {
            Ok(GraphemeScanEvent::Scalar(character)) => scalars.push(character),
            Ok(GraphemeScanEvent::Boundary { utf16_offset }) => boundaries.push(utf16_offset),
            Ok(GraphemeScanEvent::Complete { grapheme_count }) => {
                return (scalars, boundaries, grapheme_count, yields);
            }
            Err(TextWorkYield) => yields += 1,
        }
    }
    panic!("scan exceeded its progress bound");
}

fn grapheme_boundaries(text: &str) -> Vec<usize> {
    let mut offset = 0;
    text.graphemes(true)
        .map(|grapheme| {
            offset += grapheme.encode_utf16().count();
            offset
        })
        .collect()
}

fn scalar_boundaries(text: &str) -> Vec<usize> {
    let mut offset = 0;
    std::iter::once(0)
        .chain(text.chars().map(|character| {
            offset += character.len_utf16();
            offset
        }))
        .collect()
}

fn meter(max_utf16_units: usize) -> TextWorkMeter {
    TextWorkMeter::new(TextWorkBudget::new(
        NonZeroUsize::new(max_utf16_units).expect("text limit is non-zero"),
        NonZeroUsize::new(1).expect("operation limit is non-zero"),
    ))
}
