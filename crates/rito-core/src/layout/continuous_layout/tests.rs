use std::num::NonZeroUsize;

use serde_json::{json, Map};

use super::{
    has_mixed_inline_content, layout_continuous_blocks, layout_continuous_floated_leaf,
    layout_continuous_text_block, relative_visual_offset, wrap_anonymous_inline_runs,
    ContinuousFloatContext, ContinuousLayoutState, ContinuousLeafLayoutSession,
    ContinuousLeafTextState, ContinuousTextLayout, ImageSizeIndex, LayoutWorkBudget,
    LayoutWorkMeter, LineBreaking, TextMeasurementFonts,
};
use crate::style::{StyledNode, StyledNodeKind};

#[test]
fn wraps_inline_siblings_between_blocks_in_anonymous_blocks() {
    let nodes = vec![
        node(StyledNodeKind::Block, vec![]),
        node(
            StyledNodeKind::Inline,
            vec![text_node("anonymous inline text")],
        ),
        node(StyledNodeKind::Block, vec![]),
    ];

    let wrapped = wrap_anonymous_inline_runs(&nodes);

    assert_eq!(wrapped.len(), 3);
    assert_eq!(wrapped[1].node_type, StyledNodeKind::Block);
    assert_eq!(wrapped[1].children, vec![nodes[1].clone()]);
    assert_eq!(wrapped[1].style["fontSize"], json!(16));
    assert_eq!(wrapped[1].style["marginTop"], json!(0));
}

#[test]
fn image_followed_by_line_break_is_mixed_inline_content() {
    let children = vec![image_node("cover.png"), text_node("\n")];

    assert!(has_mixed_inline_content(&children));

    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let blocks = layout_continuous_blocks(
        &[node(StyledNodeKind::Block, children)],
        320.0,
        600.0,
        &images,
        LineBreaking::Greedy,
        &fonts,
    );
    assert_eq!(blocks.len(), 1);
}

#[test]
fn production_leaf_resumes_mapping_context_and_lines_in_order() {
    let content = "bounded mapping and context assembly 😀 across several lines ".repeat(12);
    let styled = paragraph(&content);
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let expected =
        layout_continuous_text_block(&styled, 180.0, 0.0, &images, LineBreaking::Greedy, &fonts);
    let mut state = ContinuousLayoutState {
        blocks: Vec::new(),
        floats: ContinuousFloatContext::default(),
        y: 0.0,
        previous_margin_bottom: 0.0,
        text_layout: ContinuousTextLayout {
            line_breaking: LineBreaking::Greedy,
            fonts: &fonts,
        },
    };
    let mut leaf = ContinuousLeafLayoutSession::new(&mut state, styled, 180.0, &images);
    let budget = LayoutWorkBudget::with_text_work_limits(
        NonZeroUsize::MIN,
        NonZeroUsize::MIN,
        NonZeroUsize::new(64).expect("atomic-operation budget is non-zero"),
    );
    let mut seen = [false; 3];
    let mut previous_phase = 0;

    for _ in 0..10_000 {
        let phase = match leaf.text_state.as_ref().expect("leaf text state") {
            ContinuousLeafTextState::FinalizingMapping(_) => 0,
            ContinuousLeafTextState::BuildingLineContext(_) => 1,
            ContinuousLeafTextState::LayoutLines(_) => 2,
        };
        assert!(phase >= previous_phase, "leaf text phases must not regress");
        previous_phase = phase;
        seen[phase] = true;
        if phase < 2 {
            assert!(
                leaf.completed_lines.is_empty(),
                "mapping and context preparation must not publish partial lines"
            );
        }
        if leaf.is_complete() {
            break;
        }
        let mut work = LayoutWorkMeter::new(budget);
        let processed = leaf.advance(&mut work, &fonts);
        work.consume_line_boxes(processed);
    }

    assert!(leaf.is_complete(), "tiny quanta must not livelock");
    assert_eq!(seen, [true, true, true]);
    assert!(leaf.completed_lines.len() > 1);
    let mut list_ctx = None;
    leaf.finish(&mut state, &mut list_ctx);
    assert_eq!(state.blocks, vec![expected]);
}

#[test]
fn text_blocks_store_only_non_default_widow_and_orphan_constraints() {
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut styled = node(StyledNodeKind::Block, vec![text_node("A short paragraph")]);
    styled.style.insert("orphans".to_owned(), json!(4));
    styled.style.insert("widows".to_owned(), json!(2));

    let block =
        layout_continuous_text_block(&styled, 320.0, 0.0, &images, LineBreaking::Greedy, &fonts);

    assert_eq!(block.orphans, Some(4));
    assert_eq!(block.widows, None);

    styled.style.insert("orphans".to_owned(), json!(2));
    styled.style.insert("widows".to_owned(), json!(5));
    let block =
        layout_continuous_text_block(&styled, 320.0, 0.0, &images, LineBreaking::Greedy, &fonts);

    assert_eq!(block.orphans, None);
    assert_eq!(block.widows, Some(5));
}

#[test]
fn relative_offsets_follow_axis_precedence() {
    let mut style = Map::from_iter([
        ("position".to_owned(), json!("relative")),
        ("top".to_owned(), json!(10)),
        ("bottom".to_owned(), json!(30)),
        ("left".to_owned(), json!(15)),
        ("right".to_owned(), json!(25)),
    ]);

    assert_eq!(relative_visual_offset(&style), Some((15.0, 10.0)));

    style.insert("top".to_owned(), json!(0));
    style.insert("left".to_owned(), json!(0));
    assert_eq!(relative_visual_offset(&style), Some((-25.0, -30.0)));

    style.insert("position".to_owned(), json!("static"));
    assert_eq!(relative_visual_offset(&style), None);

    style.insert("position".to_owned(), json!("relative"));
    style.insert("bottom".to_owned(), json!(0));
    style.insert("right".to_owned(), json!(0));
    assert_eq!(relative_visual_offset(&style), None);
}

#[test]
fn relative_leaf_offset_preserves_flow_and_existing_paint() {
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut relative = paragraph("Relative");
    relative.style.extend([
        ("position".to_owned(), json!("relative")),
        ("top".to_owned(), json!(10)),
        ("left".to_owned(), json!(20)),
        ("backgroundColor".to_owned(), json!("#eeeeee")),
    ]);
    let blocks = layout_continuous_blocks(
        &[relative, paragraph("Sibling")],
        320.0,
        600.0,
        &images,
        LineBreaking::Greedy,
        &fonts,
    );

    assert_eq!(blocks.len(), 2);
    assert_eq!(
        blocks[0].paint.as_ref().map(|paint| &paint["visualOffset"]),
        Some(&json!({ "dx": 20, "dy": 10 }))
    );
    assert_eq!(
        blocks[0]
            .paint
            .as_ref()
            .map(|paint| &paint["background"]["color"]),
        Some(&json!("#eeeeee"))
    );
    assert_eq!(blocks[1].y, blocks[0].y + blocks[0].height);
}

#[test]
fn relative_offset_is_applied_to_floated_leaves() {
    let images = ImageSizeIndex::new(&[]);
    let fonts = TextMeasurementFonts::empty();
    let mut floated = paragraph("Float");
    floated.style.extend([
        ("position".to_owned(), json!("relative")),
        ("bottom".to_owned(), json!(5)),
        ("right".to_owned(), json!(8)),
    ]);

    let block = layout_continuous_floated_leaf(
        &floated,
        160.0,
        &images,
        LineBreaking::Greedy,
        &fonts,
        &mut None,
    );

    assert_eq!(
        block.paint.as_ref().map(|paint| &paint["visualOffset"]),
        Some(&json!({ "dx": -8, "dy": -5 }))
    );
}

fn paragraph(content: &str) -> StyledNode {
    let mut paragraph = node(StyledNodeKind::Block, vec![text_node(content)]);
    paragraph.style.insert("marginTop".to_owned(), json!(0));
    paragraph.style.insert("marginBottom".to_owned(), json!(0));
    paragraph
}

fn text_node(content: &str) -> StyledNode {
    let mut text = node(StyledNodeKind::Text, vec![]);
    text.content = Some(content.to_owned());
    text
}

fn image_node(src: &str) -> StyledNode {
    let mut image = node(StyledNodeKind::Image, vec![]);
    image.src = Some(src.to_owned());
    image
}

fn node(node_type: StyledNodeKind, children: Vec<StyledNode>) -> StyledNode {
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
            ("fontSize".to_owned(), json!(16)),
            ("marginTop".to_owned(), json!(12)),
        ]),
        children,
        source_ref: None,
    }
}
