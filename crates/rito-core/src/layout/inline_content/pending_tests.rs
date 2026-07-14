use std::{num::NonZeroUsize, sync::Arc};

use serde_json::{json, Map, Value};

use super::{
    begin_collect_inline_content, collect_inline_content_candidates, flatten_inline_content,
};
use crate::{
    layout::{
        image_size::ImageSizeIndex,
        inline_segment::{InlineSegment, SegmentContext, TextSegment},
        text_mapping::{
            PendingInlineTextFlowFinalizer, RunTextMapping, TextMappingUnavailableReason,
            TextSegmentMapping,
        },
        text_work::{TextWorkBudget, TextWorkMeter},
    },
    resources::BinaryResourceSummary,
    style::{StyledNode, StyledNodeKind},
    xhtml::SourceRef,
};

#[test]
fn pending_whitespace_and_provenance_match_eager_at_tiny_quanta() {
    let nodes = vec![
        text_node("a ", None, Some(0), "normal"),
        text_node(" b ", None, Some(1), "normal"),
        text_node(" c", None, None, "normal"),
        text_node("d e", Some("d   \n e"), Some(3), "pre-wrap"),
        text_node("\n", None, Some(4), "normal"),
        image_node(),
        text_node(" f", None, Some(6), "normal"),
    ];
    let expected = flatten_inline_content(&nodes, SegmentContext::default());
    for quantum in [1, 2, usize::MAX] {
        let (actual, yields) = drive_final(nodes.clone(), None, quantum);
        assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
        if quantum == 1 {
            assert!(yields > 0, "q1 must exercise resumable text work");
        }
    }

    let text = text_segments(&expected);
    assert_eq!(text[1].text, "b ");
    assert_eq!(text[1].source_text.as_deref(), Some(" b "));
    assert_eq!(text[1].source_text_offset, Some(1));
    assert!(matches!(
        text[1].mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Exact(_))
    ));
    assert_eq!(text[2].text, "c");
    assert_eq!(text[2].source_text, None);
    assert_eq!(text[2].source_text_offset, Some(1));
    assert_unavailable(text[2], TextMappingUnavailableReason::PseudoContent);
    assert_eq!(text[3].text, "d   \n e");
    assert_eq!(text[3].source_text.as_deref(), Some("d   \n e"));
    assert_unavailable(
        text[3],
        TextMappingUnavailableReason::RestoredParserWhitespace,
    );
    assert!(matches!(
        text[4].mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Exact(_))
    ));
    assert_eq!(text[5].text, " f");
    assert_eq!(text[5].source_text_offset, None);
}

#[test]
fn owned_atoms_and_ignored_blocks_match_eager_with_shared_image_index() {
    let inline_block = block_node("inline-block", Vec::new());
    let ignored = block_node("block", vec![text_node("ignored", None, Some(9), "normal")]);
    let nodes = vec![inline_node(vec![
        image_node(),
        inline_block,
        ignored,
        text_node("tail", None, Some(3), "normal"),
    ])];
    let image_sizes = Arc::new(ImageSizeIndex::new(&[BinaryResourceSummary {
        href: "OPS/image.png".to_owned(),
        byte_length: 0,
        byte_hash: Some("0".to_owned()),
        width: Some(30),
        height: Some(40),
    }]));
    let context = SegmentContext {
        image_sizes: Some(&image_sizes),
        href: Some("chapter.xhtml".to_owned()),
        ..SegmentContext::default()
    };
    let expected = collect_inline_content_candidates(&nodes, context);

    for quantum in [1, 2, usize::MAX] {
        let (actual, yields) = drive_collection(
            nodes.clone(),
            Some(Arc::clone(&image_sizes)),
            Some("chapter.xhtml".to_owned()),
            quantum,
        );
        assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
        if quantum == 1 {
            assert!(yields > 0);
        }
    }
    assert_eq!(
        expected.iter().filter(|segment| segment.is_atom()).count(),
        2
    );
    assert_eq!(text_segments(&expected).len(), 1);
}

#[test]
fn deep_empty_inline_frames_pay_each_dispatch_and_finish_without_livelock() {
    let mut nested = inline_node(Vec::new());
    for _ in 0..64 {
        nested = inline_node(vec![nested]);
    }
    let (segments, yields) = drive_collection(vec![nested], None, None, 1);
    assert!(segments.is_empty());
    assert!(yields >= 64, "deep frame exits must span many quanta");
}

#[test]
fn ignored_deep_block_subtrees_are_discarded_iteratively_under_budget() {
    let mut nested = ignored_block(Vec::new());
    for _ in 0..2_048 {
        nested = ignored_block(vec![nested]);
    }
    let (segments, yields) = drive_collection(vec![nested], None, None, 1);
    assert!(segments.is_empty());
    assert!(yields >= 2_048, "discarded nodes must span many quanta");
}

#[test]
fn suspended_deep_trees_drop_iteratively_without_stack_overflow() {
    let mut nested = ignored_block(Vec::new());
    for _ in 0..16_384 {
        nested = ignored_block(vec![nested]);
    }
    let mut pending = begin_collect_inline_content(vec![nested], None, None);
    let mut work = TextWorkMeter::new(budget(1));
    assert!(pending.advance(&mut work).is_err());
    drop(pending);

    let mut nested = empty_inline(Vec::new());
    for _ in 0..16_384 {
        nested = empty_inline(vec![nested]);
    }
    let mut pending = begin_collect_inline_content(vec![nested], None, None);
    let mut work = TextWorkMeter::new(budget(1));
    assert!(pending.advance(&mut work).is_err());
    drop(pending);
}

#[test]
fn contextual_lowercase_resumes_with_eager_parity() {
    let mut lower = text_node("ΟΣ", None, Some(0), "normal");
    lower
        .style
        .insert("textTransform".to_owned(), json!("lowercase"));
    let nodes = vec![lower];
    let expected = collect_inline_content_candidates(&nodes, SegmentContext::default());
    let mut pending = begin_collect_inline_content(nodes, None, None);
    let budget = TextWorkBudget::new(NonZeroUsize::MAX, NonZeroUsize::MIN);
    let mut yields = 0;
    let actual = loop {
        let mut work = TextWorkMeter::new(budget);
        match pending.advance(&mut work) {
            Ok(segments) => break segments,
            Err(_) => yields += 1,
        }
        assert!(
            yields < 10,
            "contextual lowercase must make bounded progress"
        );
    };
    assert!(yields > 0, "the operation limit must exercise resumption");
    assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
}

#[test]
fn ordinary_transform_reserves_each_buffer_once_without_partial_publish() {
    let mut upper = text_node("abc", None, None, "normal");
    upper
        .style
        .insert("textTransform".to_owned(), json!("uppercase"));
    let nodes = vec![upper];
    let expected = collect_inline_content_candidates(&nodes, SegmentContext::default());
    let mut pending = begin_collect_inline_content(nodes, None, None);
    let budget = TextWorkBudget::new(NonZeroUsize::MAX, NonZeroUsize::MIN);

    let mut first = TextWorkMeter::new(budget);
    assert!(
        pending.advance(&mut first).is_err(),
        "the second reserve must wait for a fresh atomic-operation slot"
    );
    let mut second = TextWorkMeter::new(budget);
    let actual = pending
        .advance(&mut second)
        .expect("successful reserves must not be repeated after resumption");

    assert_eq!(format!("{actual:#?}"), format!("{expected:#?}"));
}

fn drive_final(
    nodes: Vec<StyledNode>,
    image_sizes: Option<Arc<ImageSizeIndex>>,
    quantum: usize,
) -> (Vec<InlineSegment>, usize) {
    let (segments, mut yields) = drive_collection(nodes, image_sizes, None, quantum);
    let mut mapping = PendingInlineTextFlowFinalizer::new(segments);
    let budget = budget(quantum);
    loop {
        let mut work = TextWorkMeter::new(budget);
        match mapping.advance(&mut work) {
            Ok(segments) => return (segments, yields),
            Err(_) => yields += 1,
        }
    }
}

fn drive_collection(
    nodes: Vec<StyledNode>,
    image_sizes: Option<Arc<ImageSizeIndex>>,
    href: Option<String>,
    quantum: usize,
) -> (Vec<InlineSegment>, usize) {
    let mut pending = begin_collect_inline_content(nodes, image_sizes, href);
    let budget = budget(quantum);
    let mut yields = 0;
    loop {
        let mut work = TextWorkMeter::new(budget);
        match pending.advance(&mut work) {
            Ok(segments) => return (segments, yields),
            Err(_) => yields += 1,
        }
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

fn assert_unavailable(segment: &TextSegment, reason: TextMappingUnavailableReason) {
    assert_eq!(
        segment.mapping,
        TextSegmentMapping::Resolved(RunTextMapping::Unavailable(reason))
    );
}

fn text_node(
    content: &str,
    source_text: Option<&str>,
    path: Option<usize>,
    white_space: &str,
) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Text, Vec::new());
    node.content = Some(content.to_owned());
    node.source_text = source_text.map(ToOwned::to_owned);
    node.source_ref = path.map(|path| SourceRef {
        node_path: vec![path],
    });
    node.style
        .insert("whiteSpace".to_owned(), json!(white_space));
    node
}

fn inline_node(children: Vec<StyledNode>) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Inline, children);
    node.tag = Some("span".to_owned());
    node
}

fn image_node() -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Image, Vec::new());
    node.src = Some("image.png".to_owned());
    node.alt = Some("image".to_owned());
    node
}

fn block_node(display: &str, children: Vec<StyledNode>) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Block, children);
    node.style.insert("display".to_owned(), json!(display));
    node.style.insert("width".to_owned(), json!(22));
    node.style.insert("height".to_owned(), json!(11));
    node
}

fn ignored_block(children: Vec<StyledNode>) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Block, children);
    node.style.clear();
    node
}

fn empty_inline(children: Vec<StyledNode>) -> StyledNode {
    let mut node = bare_node(StyledNodeKind::Inline, children);
    node.tag = Some("span".to_owned());
    node.style.clear();
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
