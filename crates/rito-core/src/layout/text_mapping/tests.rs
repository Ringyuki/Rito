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
    assert_eq!(slice.flow.non_boundaries.as_ref(), &[2]);
    assert_eq!(slice.flow.validate(), Ok(()));
    assert!(matches!(
        &slice.flow.spans()[0].source,
        LogicalTextSource::ExactLinear {
            source_start: 0,
            ..
        }
    ));
}

#[test]
fn exact_source_slice_starts_at_the_visible_utf16_subslice() {
    let mut segments = vec![mapped_segment("A𠮷B")];
    finalize_inline_text_flow(&mut segments);
    let InlineSegment::Text(segment) = &segments[0] else {
        panic!("text segment expected");
    };
    let TextSegmentMapping::Resolved(mapping) = &segment.mapping else {
        panic!("resolved mapping expected");
    };
    let visible = mapping.subslice(1, 3);

    let source = visible
        .exact_source_slice()
        .expect("visible exact slice retains source ownership");

    assert_eq!(source.node_path, vec![1, 2]);
    assert_eq!(source.source_start, 1);
    assert_eq!(source.source_length, 2);
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
        source_text: Some(text.into()),
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
    assert_eq!(
        mapping.subslice(2, 3),
        RunTextMapping::Unavailable(TextMappingUnavailableReason::InvalidTextBoundary)
    );
}

#[test]
fn ascii_flows_need_no_utf16_boundary_index_entries() {
    let text = "a".repeat(10_000);
    let mut segments = vec![mapped_segment(&text)];
    finalize_inline_text_flow(&mut segments);
    let InlineSegment::Text(segment) = &segments[0] else {
        unreachable!();
    };
    let TextSegmentMapping::Resolved(RunTextMapping::Exact(slice)) = &segment.mapping else {
        unreachable!();
    };

    assert!(slice.flow.non_boundaries.is_empty());
    assert_eq!(slice.flow.validate(), Ok(()));
    assert!(matches!(
        segment.mapping.run_mapping(9_999, 10_000),
        RunTextMapping::Exact(_)
    ));
}

#[test]
fn utf16_boundary_index_tracks_only_surrogate_interiors() {
    let mut segments = vec![mapped_segment("𠮷A😀B𐐀")];
    finalize_inline_text_flow(&mut segments);
    let InlineSegment::Text(segment) = &segments[0] else {
        unreachable!();
    };
    let TextSegmentMapping::Resolved(RunTextMapping::Exact(slice)) = &segment.mapping else {
        unreachable!();
    };

    assert_eq!(slice.flow.non_boundaries.as_ref(), &[1, 4, 7]);
    for target in [1, 4, 7] {
        assert!(!slice.flow.is_utf16_boundary(target));
    }
    for target in [0, 2, 3, 5, 6, 8] {
        assert!(slice.flow.is_utf16_boundary(target));
    }
    assert!(!slice.flow.is_utf16_boundary(9));
}

#[test]
fn utf16_boundary_index_rebases_entries_across_segments() {
    let mut segments = vec![mapped_segment("A😀"), mapped_segment("𠮷B")];
    finalize_inline_text_flow(&mut segments);
    let InlineSegment::Text(first) = &segments[0] else {
        unreachable!();
    };
    let TextSegmentMapping::Resolved(RunTextMapping::Exact(first)) = &first.mapping else {
        unreachable!();
    };
    let InlineSegment::Text(second) = &segments[1] else {
        unreachable!();
    };
    let TextSegmentMapping::Resolved(RunTextMapping::Exact(second)) = &second.mapping else {
        unreachable!();
    };

    assert!(Arc::ptr_eq(&first.flow, &second.flow));
    assert_eq!(first.flow.non_boundaries.as_ref(), &[2, 4]);
    assert_eq!((first.logical_start, first.logical_end), (0, 3));
    assert_eq!((second.logical_start, second.logical_end), (3, 6));
    assert_eq!(first.flow.validate(), Ok(()));
}
