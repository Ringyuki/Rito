use std::{num::NonZeroUsize, sync::Arc};

use serde_json::Map;

use super::{
    eager::{finalize_inline_text_flow, finalize_inline_text_flow_with_limits},
    pending::PendingInlineTextFlowFinalizer,
};
use crate::layout::{
    inline_segment::{AtomSegment, InlineSegment, TextSegment},
    text_mapping::{
        RunTextMapping, TextMappingCandidate, TextMappingCandidateSource,
        TextMappingUnavailableReason, TextSegmentMapping, TextSourceBasis,
    },
    text_work::{TextWorkBudget, TextWorkMeter, TextWorkYield},
};

#[test]
fn pending_flow_matches_the_independent_eager_reference_at_all_quantums() {
    let input = mixed_segments();
    let mut expected = input.clone();
    finalize_inline_text_flow(&mut expected);

    for quantum in [1, 2, 3, usize::MAX] {
        let (actual, yields) = drive(PendingInlineTextFlowFinalizer::new(input.clone()), quantum);
        assert_segments_equal(&expected, &actual);
        if quantum != usize::MAX {
            assert!(yields > 0, "tiny quantum must exercise resumption");
        }
        assert_mixed_flow(&actual);
    }
}

#[test]
fn no_candidate_flow_preserves_atoms_and_resolved_segments() {
    let (empty, empty_yields) = drive(PendingInlineTextFlowFinalizer::new(Vec::new()), 1);
    assert!(empty.is_empty());
    assert_eq!(empty_yields, 0);
    let input = vec![atom(), resolved_segment("ready")];
    let (actual, yields) = drive(PendingInlineTextFlowFinalizer::new(input.clone()), 1);

    assert!(yields > 0);
    assert_segments_equal(&input, &actual);
}

#[test]
fn feasible_utf16_limit_matches_reference_on_both_sides_of_boundary() {
    let empty_at_max = vec![exact_segment("", vec![0], usize::MAX)];
    assert_limited_matches_reference(empty_at_max, 0, u32::MAX, 1);
    let within = vec![exact_segment("A😀", vec![1], 4)];
    assert_limited_matches_reference(within, 3, u32::MAX, 1);

    let over = vec![
        exact_segment("A😀", vec![1], 4),
        unavailable_segment("B"),
        exact_segment("", vec![2], usize::MAX),
        atom(),
        resolved_segment("ready"),
    ];
    let actual = assert_limited_matches_reference(over, 3, u32::MAX, 1);
    assert_all_candidates_failed(&actual[..3]);
}

#[test]
fn feasible_span_index_limit_counts_empty_and_unavailable_candidates() {
    let input = vec![
        exact_segment("", vec![1], 0),
        unavailable_segment(""),
        exact_segment("", vec![2], 0),
    ];
    let actual = assert_limited_matches_reference(input, u32::MAX, 1, 2);

    assert_all_candidates_failed(&actual);
}

#[test]
fn overflowing_exact_source_range_fails_the_whole_flow_closed() {
    let input = vec![
        exact_segment("x", vec![1], usize::MAX),
        unavailable_segment(""),
        exact_segment("", vec![2], usize::MAX),
        atom(),
        resolved_segment("ready"),
    ];
    let mut expected = input.clone();
    finalize_inline_text_flow(&mut expected);

    for quantum in [1, 2, 3, usize::MAX] {
        let (actual, _) = drive(PendingInlineTextFlowFinalizer::new(input.clone()), quantum);
        assert_segments_equal(&expected, &actual);
        assert_all_candidates_failed(&actual[..3]);
        assert!(matches!(actual[3], InlineSegment::Atom(_)));
        assert_eq!(mapping(&actual[4]), mapping(&input[4]));
    }
}

#[test]
fn prevalidated_candidate_preserves_eager_reason_priority() {
    let cases = [
        (
            "restored",
            None,
            TextSourceBasis::RestoredParserWhitespace,
            "changed",
            false,
        ),
        ("\r\n", None, TextSourceBasis::ParsedText, "ab", false),
        ("plain", None, TextSourceBasis::ParsedText, "plain", true),
        (
            "exact",
            Some(vec![2]),
            TextSourceBasis::ParsedText,
            "EXACT",
            true,
        ),
    ];
    for (logical, path, basis, display, linear) in cases {
        let eager = TextMappingCandidate::new(logical.to_owned(), path.clone(), 3, basis, display);
        let prevalidated =
            TextMappingCandidate::new_prevalidated(logical.to_owned(), path, 3, basis, linear);
        assert_eq!(prevalidated.source(), eager.source());
    }
    assert!(matches!(
        TextMappingCandidate::new_prevalidated(
            "x".to_owned(),
            None,
            0,
            TextSourceBasis::ParsedText,
            false,
        )
        .source(),
        TextMappingCandidateSource::Unavailable(
            TextMappingUnavailableReason::NonLinearTextTransform
        )
    ));
}

fn assert_limited_matches_reference(
    input: Vec<InlineSegment>,
    max_utf16_len: u32,
    max_span_index: u32,
    quantum: usize,
) -> Vec<InlineSegment> {
    let mut expected = input.clone();
    finalize_inline_text_flow_with_limits(&mut expected, max_utf16_len, max_span_index);
    let pending =
        PendingInlineTextFlowFinalizer::with_test_limits(input, max_utf16_len, max_span_index);
    let (actual, _) = drive(pending, quantum);
    assert_segments_equal(&expected, &actual);
    actual
}

fn drive(
    mut pending: PendingInlineTextFlowFinalizer,
    quantum: usize,
) -> (Vec<InlineSegment>, usize) {
    let mut yields = 0;
    loop {
        let budget = TextWorkBudget::new(
            NonZeroUsize::new(quantum).expect("test quantum is non-zero"),
            NonZeroUsize::MAX,
        );
        let mut work = TextWorkMeter::new(budget);
        match pending.advance(&mut work) {
            Ok(segments) => return (segments, yields),
            Err(TextWorkYield) => yields += 1,
        }
    }
}

fn assert_mixed_flow(segments: &[InlineSegment]) {
    let empty = exact_mapping(&segments[2]);
    let astral = exact_mapping(&segments[4]);
    let last = exact_mapping(&segments[6]);
    assert!(Arc::ptr_eq(&empty.flow, &astral.flow));
    assert!(Arc::ptr_eq(&astral.flow, &last.flow));
    assert_eq!(last.flow.text(), "A😀ßZ");
    assert_eq!(last.flow.spans().len(), 5);
    assert_eq!((empty.logical_start, empty.logical_end), (0, 0));
    assert_eq!((astral.logical_start, astral.logical_end), (0, 3));
    assert_eq!((last.logical_start, last.logical_end), (4, 5));
    assert_eq!(last.flow.non_boundaries.as_ref(), &[2]);
    assert_eq!(last.flow.validate(), Ok(()));
    assert_eq!(
        mapping(&segments[3]),
        &TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
            TextMappingUnavailableReason::PseudoContent
        ))
    );
    assert_eq!(
        mapping(&segments[5]),
        &TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
            TextMappingUnavailableReason::RestoredParserWhitespace
        ))
    );
    assert_eq!(
        run_mapping(&segments[6])
            .exact_source_slice()
            .expect("exact source")
            .node_path,
        vec![7, 8]
    );
}

fn mixed_segments() -> Vec<InlineSegment> {
    let mut last = exact_segment("Z", vec![7, 8], 9);
    last.as_text_mut().expect("text").source_path = Some(vec![99]);
    vec![
        atom(),
        resolved_segment("ready"),
        exact_segment("", vec![1], 5),
        unavailable_segment(""),
        exact_segment("A😀", vec![2], 0),
        restored_segment("ß"),
        last,
    ]
}

fn exact_segment(text: &str, path: Vec<usize>, source_start: usize) -> InlineSegment {
    candidate_segment(text, Some(path), source_start, TextSourceBasis::ParsedText)
}

fn unavailable_segment(text: &str) -> InlineSegment {
    candidate_segment(text, None, 0, TextSourceBasis::ParsedText)
}

fn restored_segment(text: &str) -> InlineSegment {
    candidate_segment(
        text,
        Some(vec![3]),
        0,
        TextSourceBasis::RestoredParserWhitespace,
    )
}

fn candidate_segment(
    text: &str,
    path: Option<Vec<usize>>,
    source_start: usize,
    basis: TextSourceBasis,
) -> InlineSegment {
    InlineSegment::Text(text_segment(
        text,
        TextSegmentMapping::Candidate(TextMappingCandidate::new(
            text.to_owned(),
            path,
            source_start,
            basis,
            text,
        )),
    ))
}

fn resolved_segment(text: &str) -> InlineSegment {
    InlineSegment::Text(text_segment(
        text,
        TextSegmentMapping::Resolved(RunTextMapping::synthetic()),
    ))
}

fn text_segment(text: &str, mapping: TextSegmentMapping) -> TextSegment {
    TextSegment {
        text: text.to_owned(),
        mapping,
        style: Map::new(),
        href: None,
        source_path: Some(vec![42]),
        source_text: Some(text.into()),
        source_text_offset: None,
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    }
}

fn atom() -> InlineSegment {
    InlineSegment::Atom(AtomSegment {
        width: 3.0,
        height: 4.0,
        style: Map::new(),
        image_src: Some("image.png".to_owned()),
        alt: Some("alt".to_owned()),
        href: None,
        source_path: Some(vec![77]),
    })
}

fn assert_all_candidates_failed(segments: &[InlineSegment]) {
    for segment in segments {
        if matches!(segment, InlineSegment::Text(_)) {
            assert_eq!(
                mapping(segment),
                &TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
                    TextMappingUnavailableReason::FlowTooLong
                ))
            );
        }
    }
}

fn assert_segments_equal(expected: &[InlineSegment], actual: &[InlineSegment]) {
    assert_eq!(expected.len(), actual.len());
    for (expected, actual) in expected.iter().zip(actual) {
        match (expected, actual) {
            (InlineSegment::Text(expected), InlineSegment::Text(actual)) => {
                assert_eq!(expected.text, actual.text);
                assert_eq!(expected.mapping, actual.mapping);
                assert_eq!(expected.source_path, actual.source_path);
            }
            (InlineSegment::Atom(_), InlineSegment::Atom(_)) => {}
            _ => panic!("segment kind changed during flow finalization"),
        }
    }
}

fn mapping(segment: &InlineSegment) -> &TextSegmentMapping {
    let InlineSegment::Text(segment) = segment else {
        panic!("text segment expected");
    };
    &segment.mapping
}

fn exact_mapping(segment: &InlineSegment) -> &super::super::TextFlowSlice {
    let RunTextMapping::Exact(slice) = run_mapping(segment) else {
        panic!("exact mapping expected");
    };
    slice
}

fn run_mapping(segment: &InlineSegment) -> &RunTextMapping {
    let TextSegmentMapping::Resolved(mapping) = mapping(segment) else {
        panic!("resolved mapping expected");
    };
    mapping
}
