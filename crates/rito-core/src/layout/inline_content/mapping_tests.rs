use std::num::NonZeroUsize;

use serde_json::{json, Map, Value};

use super::{begin_collect_inline_content, flatten_inline_content};
use crate::{
    layout::{
        inline_segment::{InlineSegment, SegmentContext, TextSegment},
        text_mapping::{
            LogicalTextSource, PendingInlineTextFlowFinalizer, RunTextMapping, TextFlowSlice,
            TextMappingUnavailableReason, TextSegmentMapping,
        },
        text_work::{TextWorkBudget, TextWorkMeter},
    },
    style::{StyledNode, StyledNodeKind},
    xhtml::SourceRef,
};

#[test]
fn pseudo_text_is_a_barrier_retained_inside_the_flow() {
    let nodes = vec![
        text_node("a", 0),
        pseudo_text_node("generated"),
        text_node("b", 2),
    ];
    let segments = flatten_inline_content(&nodes, SegmentContext::default());
    let text = text_segments(&segments);
    let flow = &exact_slice(text[0]).flow;

    assert_eq!(flow.text(), "ageneratedb");
    assert_eq!(
        text[1].mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
            TextMappingUnavailableReason::PseudoContent
        ))
    );
    assert!(matches!(
        flow.spans()[1].source,
        LogicalTextSource::Unavailable(TextMappingUnavailableReason::PseudoContent)
    ));
}

#[test]
fn ruby_flow_contains_only_selectable_base_text() {
    let ruby = inline_node(
        "ruby",
        vec![
            text_node("漢", 0),
            inline_node("rt", vec![text_node("かん", 1)]),
        ],
    );
    let segments = flatten_inline_content(&[ruby], SegmentContext::default());
    let text = text_segments(&segments);

    assert_eq!(text.len(), 1);
    assert_eq!(text[0].ruby_annotation.as_deref(), Some("かん"));
    assert_eq!(exact_slice(text[0]).flow.text(), "漢");
}

#[test]
fn pending_inline_flow_matches_eager_at_tiny_and_unbounded_quanta() {
    let nodes = vec![
        text_node("a😀 ", 0),
        pseudo_text_node("generated"),
        inline_node(
            "ruby",
            vec![
                text_node("漢", 2),
                inline_node("rt", vec![text_node("かん", 3)]),
            ],
        ),
        text_node(" z", 4),
    ];
    let expected = flatten_inline_content(&nodes, SegmentContext::default());

    for quantum in [1, 2, 3, usize::MAX] {
        let actual = finish_pending_inline_content(&nodes, quantum);
        assert_eq!(
            format!("{actual:#?}"),
            format!("{expected:#?}"),
            "text quantum {quantum}"
        );
    }
}

#[test]
fn pending_ordinary_nested_inline_marks_fragments_with_eager_parity() {
    let mut inner = inline_node(
        "span",
        vec![text_node("a😀", 0), image_node(), text_node("b", 2)],
    );
    inner.style.extend([
        ("marginLeft".to_owned(), json!(3)),
        ("marginRight".to_owned(), json!(4)),
        ("borderTop".to_owned(), border()),
    ]);
    let mut outer = inline_node("span", vec![inner]);
    outer.style.extend([
        ("marginLeft".to_owned(), json!(7)),
        ("marginRight".to_owned(), json!(8)),
        ("borderBottom".to_owned(), border()),
    ]);
    let nodes = vec![outer];
    let expected = flatten_inline_content(&nodes, SegmentContext::default());

    for quantum in [1, 2, 3, usize::MAX] {
        let actual = finish_pending_inline_content(&nodes, quantum);
        assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
    }

    let text = text_segments(&expected);
    assert_eq!(text[0].inline_margin_left, Some(7.0));
    assert_eq!(text[1].inline_margin_right, Some(8.0));
    assert!(text[0].border_start);
    assert!(text[1].border_end);
}

#[test]
fn pending_text_transforms_match_eager_across_astral_and_fallback_cases() {
    let nodes = vec![
        transformed_text_node("hello😀", 0, "uppercase"),
        transformed_text_node("aß", 1, "uppercase"),
        transformed_text_node("hello_world again", 2, "capitalize"),
        transformed_text_node("𐐨", 3, "uppercase"),
        transformed_text_node("a\u{0345}", 4, "uppercase"),
        transformed_text_node("ΟΣ", 5, "lowercase"),
        transformed_text_node("ΟΣΑ", 6, "lowercase"),
    ];
    let expected = assert_pending_matches_eager(&nodes);
    let text = text_segments(&expected);
    assert_eq!(
        text[4].mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
            TextMappingUnavailableReason::NonLinearTextTransform
        ))
    );
    assert_eq!(text[1].text, "aß");
    assert_eq!(text[3].text, "𐐀");
    assert_eq!(text[5].text, "ος");
    assert_eq!(text[6].text, "οσα");
}

#[test]
fn pending_transform_boundaries_match_eager_at_tiny_quanta() {
    let nodes = vec![
        transformed_text_node("\u{212a}", 0, "lowercase"),
        transformed_text_node("\u{130}", 1, "lowercase"),
        transformed_text_node("ΟΣ\u{301}", 2, "lowercase"),
    ];
    let expected = assert_pending_matches_eager(&nodes);
    let text = text_segments(&expected);

    assert_eq!(text[0].text, "k");
    assert!(matches!(
        text[0].mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Exact(_))
    ));
    assert_eq!(text[1].text, "\u{130}");
    assert!(matches!(
        text[1].mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Exact(_))
    ));
    assert_eq!(text[2].text, "ος\u{301}");
}

#[test]
fn pending_transform_unavailable_reason_priority_matches_eager() {
    let mut pseudo_nonlinear = pseudo_text_node("a\u{345}");
    set_transform(&mut pseudo_nonlinear, "uppercase");
    let mut restored_nonlinear = transformed_text_node("a\u{345}", 1, "uppercase");
    restored_nonlinear.source_text = Some("a\u{345}".to_owned());
    restored_nonlinear
        .style
        .insert("whiteSpace".to_owned(), json!("pre-wrap"));
    let expected = assert_pending_matches_eager(&[pseudo_nonlinear, restored_nonlinear]);
    let text = text_segments(&expected);

    assert_eq!(
        text[0].mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
            TextMappingUnavailableReason::NonLinearTextTransform
        ))
    );
    assert_eq!(
        text[1].mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
            TextMappingUnavailableReason::RestoredParserWhitespace
        ))
    );
}

fn assert_pending_matches_eager(nodes: &[StyledNode]) -> Vec<InlineSegment> {
    let expected = flatten_inline_content(nodes, SegmentContext::default());
    for quantum in [1, 2, 3, usize::MAX] {
        let actual = finish_pending_inline_content(nodes, quantum);
        assert_eq!(
            format!("{actual:#?}"),
            format!("{expected:#?}"),
            "text quantum {quantum}"
        );
    }
    expected
}

fn finish_pending_inline_content(nodes: &[StyledNode], quantum: usize) -> Vec<InlineSegment> {
    let mut collection = begin_collect_inline_content(nodes.to_vec(), None, None);
    let budget = TextWorkBudget::new(non_zero(quantum), NonZeroUsize::MAX);
    for _ in 0..10_000 {
        let mut work = TextWorkMeter::new(budget);
        if let Ok(segments) = collection.advance(&mut work) {
            let mut mapping = PendingInlineTextFlowFinalizer::new(segments);
            for _ in 0..10_000 {
                let mut work = TextWorkMeter::new(budget);
                if let Ok(segments) = mapping.advance(&mut work) {
                    return segments;
                }
            }
            panic!("pending inline mapping must not livelock");
        }
    }
    panic!("pending inline content must not livelock");
}

fn non_zero(value: usize) -> NonZeroUsize {
    NonZeroUsize::new(value).expect("test quantum is non-zero")
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

fn text_node(content: &str, path: usize) -> StyledNode {
    StyledNode::text(
        content.to_owned(),
        None,
        style(),
        SourceRef {
            node_path: vec![path],
        },
    )
}

fn transformed_text_node(content: &str, path: usize, transform: &str) -> StyledNode {
    let mut node = text_node(content, path);
    set_transform(&mut node, transform);
    node
}

fn set_transform(node: &mut StyledNode, transform: &str) {
    node.style
        .insert("textTransform".to_owned(), json!(transform));
}

fn pseudo_text_node(content: &str) -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Text,
        tag: None,
        content: Some(content.to_owned()),
        source_text: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: style(),
        children: Vec::new(),
        source_ref: None,
    }
}

fn image_node() -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Image,
        tag: None,
        content: None,
        source_text: None,
        src: Some("missing.png".to_owned()),
        alt: Some("image".to_owned()),
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: style(),
        children: Vec::new(),
        source_ref: Some(SourceRef { node_path: vec![1] }),
    }
}

fn inline_node(tag: &str, children: Vec<StyledNode>) -> StyledNode {
    StyledNode {
        node_type: StyledNodeKind::Inline,
        tag: Some(tag.to_owned()),
        content: None,
        source_text: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: style(),
        children,
        source_ref: None,
    }
}

fn style() -> Map<String, Value> {
    Map::from_iter([
        ("whiteSpace".to_owned(), Value::String("normal".to_owned())),
        ("textTransform".to_owned(), Value::String("none".to_owned())),
    ])
}

fn border() -> Value {
    json!({ "width": 1, "style": "solid", "color": "#000000" })
}
