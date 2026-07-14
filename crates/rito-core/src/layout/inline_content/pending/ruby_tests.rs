use std::{num::NonZeroUsize, sync::Arc};

use serde_json::{json, Map, Value};

use super::super::PendingInlineCandidateCollector;
use crate::{
    layout::{
        image_size::ImageSizeIndex,
        inline_content::collect_inline_content_candidates,
        inline_segment::{InlineSegment, SegmentContext, TextSegment},
        text_work::{TextWorkBudget, TextWorkMeter},
    },
    resources::BinaryResourceSummary,
    style::{StyledNode, StyledNodeKind},
};

#[test]
fn ruby_grammar_whitespace_and_nested_annotations_match_eager() {
    let nested_overridden = ruby(vec![text("inner"), rt(vec![text("IN")])]);
    let nested_preserved = ruby(vec![text("kept"), rt(vec![text("KEEP")])]);
    let nodes = vec![
        text("before "),
        ruby(vec![
            text(" base "),
            rp(vec![text("ignored")]),
            nested_overridden,
            rt(vec![text("OUT")]),
            text(" loose "),
            rb(vec![inline("span", vec![text(" rb"), image()])]),
            rt(vec![inline("span", vec![text("R"), text("😀")])]),
            image(),
            block("block", vec![text("ignored block")]),
            text(" tail"),
        ]),
        ruby(vec![nested_preserved]),
        ruby(vec![
            rt(vec![text("orphan annotation")]),
            rb(vec![text("first rb")]),
            rb(vec![text("second rb")]),
            rt(vec![text("SECOND")]),
            rt(vec![text("orphan tail")]),
        ]),
        text(" after"),
    ];
    assert_pending_matches_eager(&nodes, None, None);

    let (actual, _) = drive(nodes, None, None, 1);
    let annotations = text_segments(&actual)
        .into_iter()
        .map(|text| text.ruby_annotation.as_deref())
        .collect::<Vec<_>>();
    assert!(annotations.contains(&Some("OUT")));
    assert!(annotations.contains(&Some("R😀")));
    assert!(annotations.contains(&Some("KEEP")));
    assert!(!actual
        .iter()
        .any(|segment| segment.text_content() == Some("ignored")));
}

#[test]
fn ruby_base_resets_context_images_and_preserves_ancestor_fragments() {
    let mut ruby_node = ruby(vec![
        inline("span", vec![text("base"), image()]),
        rt(vec![text("annotation")]),
    ]);
    ruby_node.href = Some("ruby-own.xhtml".to_owned());
    ruby_node
        .style
        .insert("backgroundColor".to_owned(), json!("#0000ff"));

    let mut outer = inline("span", vec![ruby_node]);
    outer.href = Some("outer.xhtml".to_owned());
    outer.style.extend([
        ("backgroundColor".to_owned(), json!("#ff0000")),
        ("verticalAlign".to_owned(), json!("super")),
        ("paddingLeft".to_owned(), json!(9)),
        ("marginLeft".to_owned(), json!(7)),
        ("marginRight".to_owned(), json!(8)),
        ("borderTop".to_owned(), border()),
    ]);
    let nodes = vec![outer];
    let images = Arc::new(ImageSizeIndex::new(&[BinaryResourceSummary {
        href: "OPS/image.png".to_owned(),
        byte_length: 0,
        byte_hash: Some("0".to_owned()),
        width: Some(300),
        height: Some(400),
    }]));

    assert_pending_matches_eager(&nodes, Some(Arc::clone(&images)), None);
    let (actual, _) = drive(nodes, Some(images), None, 1);
    let text = text_segments(&actual)[0];
    assert_eq!(text.href.as_deref(), Some("outer.xhtml"));
    assert_eq!(text.style.get("backgroundColor"), Some(&json!("#ff0000")));
    assert_eq!(text.style.get("verticalAlign"), Some(&json!("super")));
    assert!(text.style.get("paddingLeft").is_none());
    assert_eq!(text.inline_margin_left, Some(7.0));
    assert_eq!(text.inline_margin_right, Some(8.0));
    assert!(text.border_start && text.border_end);

    let atom = actual
        .iter()
        .find_map(|segment| match segment {
            InlineSegment::Atom(atom) => Some(atom),
            InlineSegment::Text(_) => None,
        })
        .expect("the nested ruby image remains an atom");
    assert_eq!((atom.width, atom.height), (16.0, 16.0));
    assert_eq!(atom.href.as_deref(), Some("outer.xhtml"));
}

#[test]
fn raw_rt_text_ignores_source_transform_and_text_children() {
    let mut raw = text("raw");
    raw.source_text = Some("restored".to_owned());
    raw.style
        .insert("textTransform".to_owned(), json!("uppercase"));
    raw.children.push(text("ignored child"));
    let nodes = vec![ruby(vec![
        text("base"),
        rt(vec![raw, block("block", vec![text("+nested")])]),
    ])];
    assert_pending_matches_eager(&nodes, None, None);
    let (actual, _) = drive(nodes, None, None, 1);
    assert_eq!(
        text_segments(&actual)[0].ruby_annotation.as_deref(),
        Some("raw+nested")
    );
}

#[test]
fn deep_annotation_resumes_at_q1_and_suspended_drop_is_stack_safe() {
    let mut annotation = text("注😀");
    for _ in 0..2_048 {
        annotation = inline("span", vec![annotation]);
    }
    let nodes = vec![ruby(vec![text("base"), rt(vec![annotation])])];
    let (actual, yields) = drive(nodes, None, None, 1);
    assert!(yields > 2_048);
    assert_eq!(
        text_segments(&actual)[0].ruby_annotation.as_deref(),
        Some("注😀")
    );

    let mut suspended = text("deep");
    for _ in 0..16_384 {
        suspended = inline("span", vec![suspended]);
    }
    let mut pending = PendingInlineCandidateCollector::new(
        vec![ruby(vec![text("base"), rt(vec![suspended])])],
        None,
        None,
    );
    // Dispatch the ruby, collect its base, enter `rt`, then let the annotation
    // extractor consume one deep wrapper before cancellation.
    for _ in 0..4 {
        let mut work = TextWorkMeter::new(budget(1));
        assert!(pending.advance(&mut work).is_err());
    }
    drop(pending);
}

fn assert_pending_matches_eager(
    nodes: &[StyledNode],
    image_sizes: Option<Arc<ImageSizeIndex>>,
    href: Option<String>,
) {
    let expected = collect_inline_content_candidates(
        nodes,
        SegmentContext {
            image_sizes: image_sizes.as_deref(),
            href: href.clone(),
            ..SegmentContext::default()
        },
    );
    for quantum in [1, 2, 3, usize::MAX] {
        let (actual, _) = drive(
            nodes.to_vec(),
            image_sizes.as_ref().map(Arc::clone),
            href.clone(),
            quantum,
        );
        assert_eq!(
            format!("{actual:#?}"),
            format!("{expected:#?}"),
            "text quantum {quantum}"
        );
    }
}

fn drive(
    nodes: Vec<StyledNode>,
    image_sizes: Option<Arc<ImageSizeIndex>>,
    href: Option<String>,
    quantum: usize,
) -> (Vec<InlineSegment>, usize) {
    let mut pending = PendingInlineCandidateCollector::new(nodes, image_sizes, href);
    let mut yields = 0;
    loop {
        let mut work = TextWorkMeter::new(budget(quantum));
        match pending.advance(&mut work) {
            Ok(output) => return (output, yields),
            Err(_) => yields += 1,
        }
        assert!(yields < 200_000, "ruby collection must not livelock");
    }
}

fn budget(quantum: usize) -> TextWorkBudget {
    TextWorkBudget::new(
        NonZeroUsize::new(quantum).expect("text quantum is non-zero"),
        NonZeroUsize::MAX,
    )
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

fn ruby(children: Vec<StyledNode>) -> StyledNode {
    inline("ruby", children)
}

fn rt(children: Vec<StyledNode>) -> StyledNode {
    inline("rt", children)
}

fn rp(children: Vec<StyledNode>) -> StyledNode {
    inline("rp", children)
}

fn rb(children: Vec<StyledNode>) -> StyledNode {
    inline("rb", children)
}

fn inline(tag: &str, children: Vec<StyledNode>) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Inline, children);
    node.tag = Some(tag.to_owned());
    node
}

fn text(content: &str) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Text, Vec::new());
    node.content = Some(content.to_owned());
    node
}

fn image() -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Image, Vec::new());
    node.src = Some("image.png".to_owned());
    node
}

fn block(display: &str, children: Vec<StyledNode>) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Block, children);
    node.style.insert("display".to_owned(), json!(display));
    node
}

fn bare_node(node_type: StyledNodeKind, children: Vec<StyledNode>) -> StyledNode {
    StyledNode {
        node_type,
        tag: None,
        content: None,
        source_text: None,
        src: None,
        alt: None,
        id: None,
        href: None,
        colspan: None,
        rowspan: None,
        style: Map::from_iter([
            ("whiteSpace".to_owned(), Value::String("normal".to_owned())),
            ("textTransform".to_owned(), Value::String("none".to_owned())),
            ("fontSize".to_owned(), json!(16)),
            ("lineHeight".to_owned(), json!(1.2)),
            ("verticalAlign".to_owned(), json!("baseline")),
        ]),
        children,
        source_ref: None,
    }
}

fn border() -> Value {
    json!({ "width": 1, "style": "solid", "color": "#000000" })
}
