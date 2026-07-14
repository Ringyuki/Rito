use super::super::super::ruby_text::{
    PendingAnnotationApply, PendingRubyAnnotation, SharedRubyAnnotation,
};
use super::*;

#[test]
fn multipart_cjk_and_astral_annotation_resumes_at_q1_with_eager_parity() {
    let nodes = vec![ruby(vec![
        text("甲"),
        text("乙"),
        rt(vec![
            text("注"),
            inline("span", vec![text("😀"), text("音")]),
        ]),
    ])];
    assert_pending_matches_eager(&nodes, None, None);

    let (actual, yields) = drive_with_limits(nodes, None, None, 1, 1);
    assert!(yields > 0);
    assert_eq!(
        text_segments(&actual)
            .into_iter()
            .map(|text| text.ruby_annotation.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("注😀音"), Some("注😀音")]
    );
}

#[test]
fn extraction_reserve_and_arc_seal_each_consume_one_atomic_slot() {
    let mut extraction = PendingRubyAnnotation::new(vec![
        text("注"),
        inline("span", vec![text("😀"), text("音")]),
    ]);

    let mut reserve_work = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    assert!(
        extraction.advance(&mut reserve_work).is_err(),
        "the Arc seal must wait after the output reserve consumes the slot"
    );
    assert_eq!(reserve_work.atomic_operations_remaining(), 0);

    let mut seal_work = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    let annotation = extraction
        .advance(&mut seal_work)
        .expect("the completed output must not be reserved again")
        .expect("the non-empty annotation must be sealed");
    assert_eq!(annotation.text(), "注😀音");
    assert_eq!(seal_work.atomic_operations_remaining(), 0);
}

#[test]
fn empty_annotation_skips_output_reserve_and_arc_seal() {
    let mut extraction = PendingRubyAnnotation::new(vec![text(""), inline("span", vec![text("")])]);
    let mut work = TextWorkMeter::new(limited_budget(usize::MAX, 1));

    assert!(extraction
        .advance(&mut work)
        .expect("empty extraction is synchronous at a large text quantum")
        .is_none());
    assert_eq!(
        work.atomic_operations_remaining(),
        1,
        "empty annotations must allocate neither an output buffer nor an Arc"
    );
}

#[test]
fn per_segment_copies_reserve_once_and_never_publish_partial_strings() {
    let annotation = extract_shared_annotation("注😀音");
    let base_nodes = vec![text("甲"), image(), text("乙")];
    let mut output = collect_inline_content_candidates(&base_nodes, SegmentContext::default());
    let output_len = output.len();
    let mut apply = PendingAnnotationApply::new(annotation, 0, output_len);

    let mut first = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    assert!(apply.advance(&mut output, &mut first).is_err());
    assert_eq!(first.atomic_operations_remaining(), 0);
    let text = text_segments(&output);
    assert_eq!(text[0].ruby_annotation.as_deref(), Some("注😀音"));
    assert_eq!(text[1].ruby_annotation, None);

    let mut second = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    assert!(apply
        .advance(&mut output, &mut second)
        .expect("the first completed copy must not be reserved again"));
    assert_eq!(second.atomic_operations_remaining(), 0);
    assert!(text_segments(&output)
        .into_iter()
        .all(|text| text.ruby_annotation.as_deref() == Some("注😀音")));
}

fn drive_with_limits(
    nodes: Vec<StyledNode>,
    image_sizes: Option<Arc<ImageSizeIndex>>,
    href: Option<String>,
    quantum: usize,
    atomic_operations: usize,
) -> (Vec<InlineSegment>, usize) {
    let mut pending = PendingInlineCandidateCollector::new(nodes, image_sizes, href);
    let mut yields = 0;
    loop {
        let mut work = TextWorkMeter::new(limited_budget(quantum, atomic_operations));
        match pending.advance(&mut work) {
            Ok(output) => return (output, yields),
            Err(_) => yields += 1,
        }
        assert!(yields < 200_000, "ruby collection must not livelock");
    }
}

fn limited_budget(quantum: usize, atomic_operations: usize) -> TextWorkBudget {
    TextWorkBudget::new(
        NonZeroUsize::new(quantum).expect("text quantum is non-zero"),
        NonZeroUsize::new(atomic_operations).expect("atomic operation limit is non-zero"),
    )
}

fn extract_shared_annotation(content: &str) -> SharedRubyAnnotation {
    let mut extraction = PendingRubyAnnotation::new(vec![text(content)]);
    let mut work = TextWorkMeter::new(limited_budget(usize::MAX, 2));
    extraction
        .advance(&mut work)
        .expect("two atomic slots cover reserve and Arc seal")
        .expect("test annotations are non-empty")
}
