use super::super::super::context::OwnedInlineContext;
use super::super::{group::PendingRubyGroupPlan, PendingRubyFrame, RubyAction};
use super::*;
use crate::layout::text_work::{AtomicTextOperationKind, TextWorkPermitResult};

#[test]
fn direct_group_reserve_is_paid_once_across_a_yield() {
    let mut frame = PendingRubyFrame::new(
        ruby(vec![text("A"), text("B")]),
        &OwnedInlineContext::root(None),
    );
    let mut output = Vec::new();

    let mut preflight = TextWorkMeter::new(limited_budget(4, 1));
    assert!(frame.advance(&mut output, 0, true, &mut preflight).is_err());
    assert_eq!(preflight.atomic_operations_remaining(), 1);

    let mut reserve_and_gather = TextWorkMeter::new(limited_budget(4, 1));
    assert!(frame
        .advance(&mut output, 0, true, &mut reserve_and_gather)
        .is_err());
    assert_eq!(reserve_and_gather.atomic_operations_remaining(), 0);

    let mut publish = TextWorkMeter::new(limited_budget(4, 1));
    let RubyAction::PushBase(nodes) = frame
        .advance(&mut output, 0, true, &mut publish)
        .expect("a completed reserve must not repeat after yielding")
    else {
        panic!("the completed direct group must be published");
    };
    assert_eq!(node_texts(&nodes), ["A", "B"]);
    assert_eq!(publish.atomic_operations_remaining(), 1);
}

#[test]
fn seed_spare_capacity_is_reused_without_atomic_admission() {
    let seed = seed_with_len_three_capacity_five();
    let direct = vec![text("D"), text("E")];
    let (boundary, work) = build_group(seed, direct, 1);

    assert_eq!(node_texts(&boundary.nodes), ["S0", "S1", "S2", "D", "E"]);
    assert_eq!(work.atomic_operations_remaining(), 1);
}

#[test]
fn reserve_exact_uses_all_direct_nodes_not_only_the_capacity_deficit() {
    let seed = seed_with_len_three_capacity_five();
    let direct = vec![text("D"), text("E"), text("F")];
    let (boundary, work) = build_group(seed, direct, 1);

    assert_eq!(
        node_texts(&boundary.nodes),
        ["S0", "S1", "S2", "D", "E", "F"]
    );
    assert_eq!(work.atomic_operations_remaining(), 0);
}

#[test]
fn large_seed_growth_waits_for_a_fresh_oversized_admission() {
    let seed = exact_seed(8);
    let direct = vec![text("tail")];
    let mut plan = PendingRubyGroupPlan::new(seed);
    let mut preflight = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    let spec = plan
        .advance(&direct, &mut preflight)
        .expect("the group preflight fits an unbounded quantum");

    let mut non_fresh = TextWorkMeter::new(limited_budget(4, 1));
    assert_eq!(non_fresh.take_utf16_units(1), 1);
    let spec = match spec.reserve(&mut non_fresh) {
        Ok(_) => panic!("an oversized reserve cannot enter a non-fresh quantum"),
        Err((spec, _)) => spec,
    };
    assert_eq!(non_fresh.atomic_operations_remaining(), 1);

    let mut fresh = TextWorkMeter::new(limited_budget(4, 1));
    let mut build = spec
        .reserve(&mut fresh)
        .expect("a fresh quantum permits one oversized reserve");
    assert_eq!(fresh.atomic_operations_remaining(), 0);
    assert_eq!(fresh.utf16_units_remaining(), 0);

    let mut direct = direct.into_iter();
    let mut q1 = TextWorkMeter::new(limited_budget(1, 1));
    let boundary = build
        .advance(&mut direct, &mut q1)
        .expect("one direct node assembles at q1");
    assert_eq!(boundary.nodes.len(), 9);
}

#[test]
fn exhausted_atomic_slot_preserves_the_reserve_for_the_next_quantum() {
    let direct = vec![text("tail")];
    let mut plan = PendingRubyGroupPlan::new(exact_seed(4));
    let mut preflight = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    let spec = plan
        .advance(&direct, &mut preflight)
        .expect("the group preflight completes");

    let mut exhausted = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    assert!(matches!(
        exhausted.try_permit_atomic(AtomicTextOperationKind::InlineCollection, 0),
        TextWorkPermitResult::Permit { .. }
    ));
    let spec = match spec.reserve(&mut exhausted) {
        Ok(_) => panic!("a reserve cannot run after the atomic slot is spent"),
        Err((spec, _)) => spec,
    };

    let mut retry = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    let mut build = spec
        .reserve(&mut retry)
        .expect("the next quantum retains and admits the reserve");
    let boundary = build
        .advance(&mut direct.into_iter(), &mut retry)
        .expect("the retained plan still gathers its direct node");
    assert_eq!(
        node_texts(&boundary.nodes),
        ["S0", "S1", "S2", "S3", "tail"]
    );
}

#[test]
fn consecutive_boundaries_and_empty_replacements_match_eager_at_q1() {
    let nodes = vec![ruby(vec![
        text("A"),
        rb(vec![text("B")]),
        rb(vec![text("C"), text("D")]),
        rt(vec![text("X")]),
        rt(vec![text("orphan")]),
        rp(vec![text("ignored")]),
        rb(Vec::new()),
        rb(vec![text("E")]),
        rt(vec![text("Y")]),
    ])];
    assert_pending_matches_eager(&nodes, None, None);
    let (actual, _) = drive_with_limits(nodes, 1, 1);

    let text = text_segments(&actual);
    assert_eq!(
        text.iter()
            .map(|text| text.text.as_str())
            .collect::<Vec<_>>(),
        ["A", "B", "C", "D", "E"]
    );
    assert_eq!(
        text.iter()
            .map(|text| text.ruby_annotation.as_deref())
            .collect::<Vec<_>>(),
        [None, None, Some("X"), Some("X"), Some("Y")]
    );
}

#[test]
fn direct_ignored_nodes_differ_from_rb_seed_nodes_with_eager_parity() {
    let nodes = vec![ruby(vec![
        image(),
        block("block", vec![text("direct ignored")]),
        rb(vec![image(), text("seed")]),
        rt(vec![text("R")]),
    ])];
    assert_pending_matches_eager(&nodes, None, None);
    let (actual, _) = drive_with_limits(nodes, 1, 1);

    assert_eq!(actual.iter().filter(|segment| segment.is_atom()).count(), 1);
    assert_eq!(text_segments(&actual)[0].text, "seed");
    assert_eq!(
        text_segments(&actual)[0].ruby_annotation.as_deref(),
        Some("R")
    );
    assert!(!actual
        .iter()
        .any(|segment| segment.text_content() == Some("direct ignored")));
}

#[test]
fn text_tags_and_nested_ruby_tags_do_not_create_direct_boundaries() {
    let mut tagged_rt = text("text-rt");
    tagged_rt.tag = Some("rt".to_owned());
    let mut tagged_rb = text("text-rb");
    tagged_rb.tag = Some("rb".to_owned());
    let nested = inline(
        "span",
        vec![
            rt(vec![text("nested-rt")]),
            rb(vec![text("nested-rb")]),
            text("tail"),
        ],
    );
    let nodes = vec![ruby(vec![
        tagged_rt,
        tagged_rb,
        nested,
        rt(vec![text("annotation")]),
    ])];

    assert_pending_matches_eager(&nodes, None, None);
    let (actual, _) = drive_with_limits(nodes, 1, 1);
    let text = text_segments(&actual);
    assert_eq!(
        text.iter().map(|run| run.text.as_str()).collect::<String>(),
        "text-rttext-rbnested-rtnested-rbtail"
    );
    assert!(text
        .iter()
        .all(|run| run.ruby_annotation.as_deref() == Some("annotation")));
}

#[test]
fn zero_base_groups_skip_capacity_admission() {
    let mut frame = PendingRubyFrame::new(
        ruby(vec![rp(Vec::new()), image(), block("block", Vec::new())]),
        &OwnedInlineContext::root(None),
    );
    let mut output = Vec::new();
    let mut work = TextWorkMeter::new(limited_budget(usize::MAX, 1));

    assert!(matches!(
        frame.advance(&mut output, 0, true, &mut work),
        Ok(RubyAction::Complete)
    ));
    assert_eq!(work.atomic_operations_remaining(), 1);
}

fn build_group(
    seed: Vec<StyledNode>,
    direct: Vec<StyledNode>,
    atomic_operations: usize,
) -> (super::super::group::PendingRubyBoundary, TextWorkMeter) {
    let mut plan = PendingRubyGroupPlan::new(seed);
    let mut preflight = TextWorkMeter::new(limited_budget(usize::MAX, 1));
    let spec = plan
        .advance(&direct, &mut preflight)
        .expect("the test group preflight completes");
    let mut work = TextWorkMeter::new(limited_budget(usize::MAX, atomic_operations));
    let mut build = spec.reserve(&mut work).expect("the test reserve completes");
    let mut direct = direct.into_iter();
    let boundary = build
        .advance(&mut direct, &mut work)
        .expect("the test group assembly completes");
    (boundary, work)
}

fn seed_with_len_three_capacity_five() -> Vec<StyledNode> {
    let mut seed = exact_seed(5);
    seed.truncate(3);
    assert_eq!(seed.capacity(), 5);
    seed
}

fn exact_seed(len: usize) -> Vec<StyledNode> {
    (0..len)
        .map(|index| text(&format!("S{index}")))
        .collect::<Vec<_>>()
        .into_boxed_slice()
        .into_vec()
}

fn node_texts(nodes: &[StyledNode]) -> Vec<&str> {
    nodes
        .iter()
        .map(|node| node.content.as_deref().unwrap_or_default())
        .collect()
}

fn drive_with_limits(
    nodes: Vec<StyledNode>,
    quantum: usize,
    atomic_operations: usize,
) -> (Vec<InlineSegment>, usize) {
    let mut pending = PendingInlineCandidateCollector::new(nodes, None, None);
    let mut yields = 0;
    loop {
        let mut work = TextWorkMeter::new(limited_budget(quantum, atomic_operations));
        match pending.advance(&mut work) {
            Ok(output) => return (output, yields),
            Err(_) => yields += 1,
        }
        assert!(yields < 200_000, "ruby group collection must not livelock");
    }
}

fn limited_budget(quantum: usize, atomic_operations: usize) -> TextWorkBudget {
    TextWorkBudget::new(
        NonZeroUsize::new(quantum).expect("text quantum is non-zero"),
        NonZeroUsize::new(atomic_operations).expect("atomic operation limit is non-zero"),
    )
}
