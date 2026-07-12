use serde_json::{Map, Value};

use super::flatten_inline_content;
use crate::{
    layout::{
        inline_segment::{InlineSegment, SegmentContext, TextSegment},
        text_mapping::{
            LogicalTextSource, RunTextMapping, TextFlowSlice, TextMappingUnavailableReason,
            TextSegmentMapping,
        },
    },
    style::{StyledNode, StyledNodeKind},
    xhtml::SourceRef,
};

#[test]
fn collapses_spaces_across_nested_inline_boundaries() {
    let nodes = vec![
        text_node("a ", None, 0, "normal"),
        inline_node(vec![text_node(" b", None, 1, "normal")]),
    ];

    let segments = flatten_inline_content(&nodes, SegmentContext::default());
    let text = text_segments(&segments);

    assert_eq!(
        text.iter()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>(),
        ["a ", "b"]
    );
    assert_eq!(text[1].source_text.as_deref(), Some(" b"));
    assert_eq!(text[1].source_text_offset, Some(1));
    let second = exact_slice(text[1]);
    assert_eq!(second.flow.text(), "a b");
    assert_eq!((second.logical_start, second.logical_end), (2, 3));
    assert!(matches!(
        &second.flow.spans()[1].source,
        LogicalTextSource::ExactLinear {
            source_start: 1,
            ..
        }
    ));
}

#[test]
fn restores_parser_source_text_for_pre_wrap() {
    let nodes = vec![text_node("a b", Some("a   \n  b"), 0, "pre-wrap")];

    let segments = flatten_inline_content(&nodes, SegmentContext::default());
    let text = text_segments(&segments);

    assert_eq!(text[0].text, "a   \n  b");
    assert_eq!(text[0].source_text.as_deref(), Some("a   \n  b"));
    assert_eq!(text[0].source_text_offset, None);
    assert_unavailable(
        text[0],
        TextMappingUnavailableReason::RestoredParserWhitespace,
    );
}

#[test]
fn parser_preserved_pre_text_keeps_an_exact_linear_mapping() {
    let segments = flatten_inline_content(
        &[text_node("a   \n  b", None, 0, "pre-wrap")],
        SegmentContext::default(),
    );
    let text = text_segments(&segments);

    assert_eq!(exact_slice(text[0]).flow.text(), "a   \n  b");
}

#[test]
fn restored_parser_whitespace_remains_a_barrier_inside_a_mixed_flow() {
    let nodes = vec![
        text_node("x", None, 0, "normal"),
        text_node("a b", Some("a   \n  b"), 1, "pre-wrap"),
        text_node("y", None, 2, "normal"),
    ];
    let segments = flatten_inline_content(&nodes, SegmentContext::default());
    let text = text_segments(&segments);
    let flow = &exact_slice(text[0]).flow;

    assert_eq!(flow.text(), "xa   \n  by");
    assert_unavailable(
        text[1],
        TextMappingUnavailableReason::RestoredParserWhitespace,
    );
    assert!(matches!(
        flow.spans()[1].source,
        LogicalTextSource::Unavailable(TextMappingUnavailableReason::RestoredParserWhitespace)
    ));
}

#[test]
fn atoms_and_forced_breaks_reset_whitespace_collapse() {
    let nodes = vec![
        text_node("a ", None, 0, "normal"),
        image_node(),
        text_node(" b ", None, 2, "normal"),
        text_node("\n", None, 3, "normal"),
        text_node(" c", None, 4, "normal"),
    ];

    let segments = flatten_inline_content(&nodes, SegmentContext::default());
    let text = text_segments(&segments);

    assert!(segments.iter().any(InlineSegment::is_atom));
    assert_eq!(
        text.iter()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>(),
        ["a ", " b ", "\n", " c"]
    );
}

#[test]
fn flow_keeps_forced_breaks_and_treats_atoms_as_zero_text() {
    let nodes = vec![
        text_node("a", None, 0, "normal"),
        image_node(),
        text_node("b", None, 2, "normal"),
        text_node("\n", None, 3, "normal"),
        text_node("c", None, 4, "normal"),
    ];
    let segments = flatten_inline_content(&nodes, SegmentContext::default());
    let text = text_segments(&segments);
    let flow = &exact_slice(text[0]).flow;

    assert_eq!(flow.text(), "ab\nc");
    assert_eq!(flow.spans().len(), 4);
    assert_eq!(
        (
            exact_slice(text[2]).logical_start,
            exact_slice(text[2]).logical_end
        ),
        (2, 3)
    );
}

#[test]
fn empty_collapsed_segment_keeps_the_shared_space_state() {
    let nodes = vec![
        text_node("a ", None, 0, "normal"),
        inline_node(vec![text_node(" ", None, 1, "normal")]),
        text_node(" b", None, 2, "normal"),
    ];

    let segments = flatten_inline_content(&nodes, SegmentContext::default());
    let text = text_segments(&segments);

    assert_eq!(
        text.iter()
            .map(|segment| segment.text.as_str())
            .collect::<Vec<_>>(),
        ["a ", "b"]
    );
    assert_eq!(text[1].source_text_offset, Some(1));
}

#[test]
fn rejects_text_transforms_that_change_utf16_source_length() {
    let mut node = text_node("ß", None, 0, "normal");
    node.style.insert(
        "textTransform".to_owned(),
        Value::String("uppercase".to_owned()),
    );

    let segments = flatten_inline_content(&[node], SegmentContext::default());
    let text = text_segments(&segments);

    assert_eq!(text[0].text, "ß");
    assert_eq!(text[0].source_text.as_deref(), Some("ß"));
    assert_eq!(exact_slice(text[0]).flow.text(), "ß");
}

#[test]
fn boundary_preserving_transform_maps_to_source_spelling() {
    let mut node = text_node("hello", None, 0, "normal");
    node.style.insert(
        "textTransform".to_owned(),
        Value::String("uppercase".to_owned()),
    );
    let segments = flatten_inline_content(&[node], SegmentContext::default());
    let text = text_segments(&segments);

    assert_eq!(text[0].text, "HELLO");
    assert_eq!(exact_slice(text[0]).flow.text(), "hello");
}

fn text_segments(segments: &[InlineSegment]) -> Vec<&TextSegment> {
    segments
        .iter()
        .filter_map(|segment| match segment {
            InlineSegment::Text(text) => Some(text),
            InlineSegment::Atom(_) => None,
        })
        .collect()
}

fn exact_slice(segment: &TextSegment) -> &TextFlowSlice {
    let TextSegmentMapping::Resolved(RunTextMapping::Exact(slice)) = &segment.mapping else {
        panic!("exact text mapping expected");
    };
    slice
}

fn assert_unavailable(segment: &TextSegment, expected: TextMappingUnavailableReason) {
    assert_eq!(
        segment.mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Unavailable(expected))
    );
}

fn text_node(
    content: &str,
    source_text: Option<&str>,
    path: usize,
    white_space: &str,
) -> StyledNode {
    StyledNode::text(
        content.to_owned(),
        source_text.map(ToOwned::to_owned),
        style(white_space),
        SourceRef {
            node_path: vec![path],
        },
    )
}

fn inline_node(children: Vec<StyledNode>) -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Inline,
        tag: Some("span".to_owned()),
        content: None,
        source_text: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: style("normal"),
        children,
        source_ref: None,
    }
}

fn image_node() -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Image,
        tag: None,
        content: None,
        source_text: None,
        src: Some("x".to_owned()),
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: style("normal"),
        children: Vec::new(),
        source_ref: Some(SourceRef { node_path: vec![1] }),
    }
}

fn style(white_space: &str) -> Map<String, Value> {
    Map::from_iter([
        (
            "whiteSpace".to_owned(),
            Value::String(white_space.to_owned()),
        ),
        ("textTransform".to_owned(), Value::String("none".to_owned())),
    ])
}
