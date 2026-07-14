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
    let expected = collect_inline_content_candidates(&nodes, SegmentContext::default());
    assert_pending_matches_eager(&nodes, None, None);

    let (actual, yields) = drive_with_limits(nodes, None, None, 1, 1);
    assert!(yields > 0);
    assert_eq!(
        format!("{actual:#?}"),
        format!("{expected:#?}"),
        "multipart nested extraction must retain eager parity at q1/atomic1"
    );
    assert_eq!(
        text_segments(&actual)
            .into_iter()
            .map(|text| text.ruby_annotation.as_deref())
            .collect::<Vec<_>>(),
        vec![Some("注😀音"), Some("注😀音")]
    );
}

#[test]
fn single_text_extraction_pays_root_part_output_and_seal_admissions() {
    let mut extraction = PendingRubyAnnotation::new(vec![text("注")]);
    assert!(extraction.has_initial_frame());

    let mut root_work = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    assert!(
        extraction.advance(&mut root_work).is_err(),
        "first-part admission must wait after root-frame admission"
    );
    assert_eq!(root_work.atomic_operations_remaining(), 0);
    assert!(!extraction.has_initial_frame());
    assert!(extraction.has_completed_text_waiting_for_part_capacity());

    let mut part_work = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    assert!(
        extraction.advance(&mut part_work).is_err(),
        "output admission must wait after first-part admission"
    );
    assert_eq!(part_work.atomic_operations_remaining(), 0);
    assert!(!extraction.has_completed_text_waiting_for_part_capacity());

    let mut output_work = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    assert!(
        extraction.advance(&mut output_work).is_err(),
        "the Arc seal must wait after output admission"
    );
    assert_eq!(output_work.atomic_operations_remaining(), 0);

    let mut seal_work = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    let annotation = extraction
        .advance(&mut seal_work)
        .expect("the admitted output must not be reserved again")
        .expect("the non-empty annotation must be sealed");
    assert_eq!(annotation.text(), "注");
    assert_eq!(seal_work.atomic_operations_remaining(), 0);
}

#[test]
fn empty_text_annotation_pays_only_root_frame_admission() {
    let mut extraction = PendingRubyAnnotation::new(vec![text("")]);
    assert!(extraction.has_initial_frame());
    let mut work = TextWorkMeter::new(limited_budget(usize::MAX, 1));

    assert!(extraction
        .advance(&mut work)
        .expect("empty extraction completes after admitting its root frame")
        .is_none());
    assert_eq!(work.atomic_operations_remaining(), 0);
    assert!(!extraction.has_initial_frame());
    assert!(!extraction.has_completed_text_waiting_for_part_capacity());
    assert!(!extraction.has_pending_discard());
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
    for _ in 0..16 {
        let mut work = TextWorkMeter::new(limited_budget(usize::MAX, 1));
        match extraction.advance(&mut work) {
            Ok(Some(annotation)) => return annotation,
            Ok(None) => panic!("test annotations are non-empty"),
            Err(_) => continue,
        }
    }
    panic!("annotation extraction did not complete with fresh atomic slots")
}
