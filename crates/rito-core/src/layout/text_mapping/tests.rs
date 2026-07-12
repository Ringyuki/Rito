use std::sync::Arc;

use serde_json::Map;

use super::{
    finalize::text_transform_is_linear, finalize_inline_text_flow, LogicalTextSource,
    RunTextMapping, TextMappingCandidate, TextMappingUnavailableReason, TextSegmentMapping,
    TextSourceBasis,
};
use crate::layout::inline_segment::{InlineSegment, TextSegment};

#[test]
fn distinguishes_linear_and_non_linear_text_transforms() {
    assert!(text_transform_is_linear("hello", "HELLO"));
    assert!(text_transform_is_linear("𐐀", "𐐨"));
    assert!(!text_transform_is_linear("𠮷a", "a𠮷"));
}

#[test]
fn exact_subslices_share_the_compact_flow() {
    let mut segments = vec![mapped_segment("A𠮷B")];
    finalize_inline_text_flow(&mut segments);
    let InlineSegment::Text(segment) = &segments[0] else {
        panic!("text segment expected");
    };
    let TextSegmentMapping::Resolved(mapping) = &segment.mapping else {
        panic!("resolved mapping expected");
    };
    let RunTextMapping::Exact(full) = mapping else {
        panic!("exact mapping expected");
    };
    let RunTextMapping::Exact(slice) = mapping.subslice(1, 3) else {
        panic!("exact UTF-16 subslice expected");
    };
    assert!(Arc::ptr_eq(&full.flow, &slice.flow));
    assert_eq!((slice.logical_start, slice.logical_end), (1, 3));
    assert_eq!(slice.flow.text(), "A𠮷B");
    assert_eq!(slice.flow.validate(), Ok(()));
    assert!(matches!(
        &slice.flow.spans()[0].source,
        LogicalTextSource::ExactLinear {
            source_start: 0,
            ..
        }
    ));
}

fn mapped_segment(text: &str) -> InlineSegment {
    InlineSegment::Text(TextSegment {
        text: text.to_owned(),
        mapping: TextSegmentMapping::Candidate(TextMappingCandidate::new(
            text.to_owned(),
            Some(vec![1, 2]),
            0,
            TextSourceBasis::ParsedText,
            text,
        )),
        style: Map::new(),
        href: None,
        source_path: Some(vec![1, 2]),
        source_text: Some(text.to_owned()),
        source_text_offset: None,
        ruby_annotation: None,
        inline_margin_left: None,
        inline_margin_right: None,
        border_start: false,
        border_end: false,
    })
}

#[test]
fn synthetic_mapping_never_becomes_exact() {
    assert_eq!(
        RunTextMapping::synthetic(),
        RunTextMapping::Unavailable(TextMappingUnavailableReason::SyntheticLayoutText)
    );
}

#[test]
fn utf16_subslice_rejects_a_boundary_inside_a_surrogate_pair() {
    let mut segments = vec![mapped_segment("A𠮷B")];
    finalize_inline_text_flow(&mut segments);
    let InlineSegment::Text(segment) = &segments[0] else {
        unreachable!();
    };
    let TextSegmentMapping::Resolved(mapping) = &segment.mapping else {
        unreachable!();
    };

    assert_eq!(
        mapping.subslice(1, 2),
        RunTextMapping::Unavailable(TextMappingUnavailableReason::InvalidTextBoundary)
    );
}
