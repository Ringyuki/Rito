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
    let mut upper = text_node("hello😀", 0);
    upper
        .style
        .insert("textTransform".to_owned(), json!("uppercase"));
    let mut fallback = text_node("aß", 1);
    fallback
        .style
        .insert("textTransform".to_owned(), json!("uppercase"));
    let mut capitalize = text_node("hello_world again", 2);
    capitalize
        .style
        .insert("textTransform".to_owned(), json!("capitalize"));
    let mut astral_upper = text_node("𐐨", 3);
    astral_upper
        .style
        .insert("textTransform".to_owned(), json!("uppercase"));
    let mut nonlinear = text_node("a\u{0345}", 4);
    nonlinear
        .style
        .insert("textTransform".to_owned(), json!("uppercase"));
    let mut contextual_lower = text_node("ΟΣ", 5);
    contextual_lower
        .style
        .insert("textTransform".to_owned(), json!("lowercase"));
    let mut contextual_lower_mid = text_node("ΟΣΑ", 6);
    contextual_lower_mid
        .style
        .insert("textTransform".to_owned(), json!("lowercase"));
    let nodes = vec![
        upper,
        fallback,
        capitalize,
        astral_upper,
        nonlinear,
        contextual_lower,
        contextual_lower_mid,
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
    assert_eq!(
        text_segments(&expected)[4].mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Unavailable(
            TextMappingUnavailableReason::NonLinearTextTransform
        ))
    );
    assert_eq!(text_segments(&expected)[1].text, "aß");
    assert_eq!(text_segments(&expected)[3].text, "𐐀");
    assert_eq!(text_segments(&expected)[5].text, "ος");
    assert_eq!(text_segments(&expected)[6].text, "οσα");
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
