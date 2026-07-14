use std::sync::Arc;

use serde_json::{json, Map, Value};

use super::super::super::collect_inline_content_candidates;
use super::super::{commit::PendingSegmentCommit, PendingInlineCandidateCollector};
use super::{exact_segments, meter, text_segment, text_segment_with_source};
use crate::{
    layout::inline_segment::{InlineSegment, SegmentContext},
    style::{StyledNode, StyledNodeKind},
};

#[test]
fn ruby_annotation_range_starts_after_a_preceding_full_output() {
    let nodes = vec![ruby(vec![text("base"), rt(vec![text("annotation")])])];
    let before = text_segment("before");
    let mut expected = vec![before.clone()];
    expected.extend(collect_inline_content_candidates(
        &nodes,
        SegmentContext::default(),
    ));

    let mut pending = PendingInlineCandidateCollector::new(nodes, None, None);
    pending.output = exact_segments([before]);
    assert_eq!(pending.output.len(), pending.output.capacity());

    let actual = drive(pending);
    assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
    assert_eq!(actual[0].ruby_annotation(), None);
    assert_eq!(actual[1].ruby_annotation(), Some("annotation"));
}

#[test]
fn atom_resets_whitespace_before_its_full_output_commit_resumes() {
    let nodes = vec![image(), text(" tail")];
    let before = text_segment("before");
    let mut expected = vec![before.clone()];
    expected.extend(collect_inline_content_candidates(
        &nodes,
        SegmentContext::default(),
    ));

    let mut pending = PendingInlineCandidateCollector::new(nodes, None, None);
    pending.output = exact_segments([before]);
    pending.whitespace.set_previous_ended_with_space(true);
    let mut first = meter(1, 1);
    assert!(pending.advance(&mut first).is_err());
    assert!(matches!(
        pending.pending_commit.as_ref(),
        Some(PendingSegmentCommit::Reserving { .. })
    ));
    assert!(!pending.whitespace.previous_ended_with_space());
    assert_eq!(pending.output.len(), 1);

    let actual = drive(pending);
    assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
    assert_eq!(actual[2].text_content(), Some(" tail"));
}

#[test]
fn mixed_nested_text_image_and_ruby_match_eager_at_q1_atomic1() {
    let nodes = vec![inline(
        "span",
        vec![
            text("A "),
            image(),
            text(" B"),
            ruby(vec![
                inline("span", vec![text("C"), image(), text(" D")]),
                rt(vec![text("R")]),
            ]),
        ],
    )];
    let expected = collect_inline_content_candidates(&nodes, SegmentContext::default());

    let actual = drive(PendingInlineCandidateCollector::new(nodes, None, None));
    assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
    let annotated = actual
        .iter()
        .filter(|segment| segment.ruby_annotation() == Some("R"))
        .count();
    assert_eq!(annotated, 2);
}

#[test]
fn collector_drop_releases_a_ready_pending_commit_without_publishing() {
    let source: Arc<str> = Arc::from("collector-owned source");
    let mut pending = PendingInlineCandidateCollector::new(Vec::new(), None, None);
    pending.pending_commit = Some(PendingSegmentCommit::new(text_segment_with_source(
        "owned",
        Arc::clone(&source),
    )));
    let mut reserve = meter(1, 1);

    assert!(pending.advance(&mut reserve).is_err());
    assert!(matches!(
        pending.pending_commit.as_ref(),
        Some(PendingSegmentCommit::Ready(_))
    ));
    assert!(pending.output.is_empty());
    assert_eq!(Arc::strong_count(&source), 2);

    drop(pending);
    assert_eq!(Arc::strong_count(&source), 1);
}

fn drive(mut pending: PendingInlineCandidateCollector) -> Vec<InlineSegment> {
    for _ in 0..10_000 {
        let mut work = meter(1, 1);
        match pending.advance(&mut work) {
            Ok(output) => return output,
            Err(_) => continue,
        }
    }
    panic!("q1/atomic1 collection must make bounded progress")
}

fn text(content: &str) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Text, Vec::new());
    node.content = Some(content.to_owned());
    node
}

fn image() -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Image, Vec::new());
    node.src = Some("image.png".to_owned());
    node.alt = Some("image".to_owned());
    node.style.insert("width".to_owned(), json!(10));
    node.style.insert("height".to_owned(), json!(20));
    node
}

fn ruby(children: Vec<StyledNode>) -> StyledNode {
    inline("ruby", children)
}

fn rt(children: Vec<StyledNode>) -> StyledNode {
    inline("rt", children)
}

fn inline(tag: &str, children: Vec<StyledNode>) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Inline, children);
    node.tag = Some(tag.to_owned());
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
        ]),
        children,
        source_ref: None,
    }
}
