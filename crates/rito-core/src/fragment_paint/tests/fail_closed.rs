//! Fail-closed and approximation contracts: a run straddling items errors, unexpressible paint still inks.

use super::*;

#[test]
fn a_text_run_crossing_item_boundaries_fails_closed() {
    let fixture = two_color_flow(|red, black| {
        vec![text_item("Red ", red, 0.0), text_item("black.", black, 0.0)]
    });
    let root = boxed_line(vec![text_run(0.0, 60.0, 2, 8)]);
    let mut commands = Vec::new();
    let error = append_fragment_display_commands(
        &mut commands,
        &fixture.tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext::default(),
    )
    .expect_err("a run straddling two items must not paint");
    assert!(
        error
            .to_string()
            .contains("do not lie inside one inline item"),
        "unexpected error: {error}"
    );
}

#[test]
fn unexpressible_pure_paint_approximates_and_still_inks() {
    let mut inline = InlineStyleTable::new(1);
    let mut style = body_style(srgb(0.0, 0.0, 0.0, 1.0));
    style.paint.opacity = UnitInterval::new(0.5).expect("opacity is bounded");
    let translucent = inline.intern_for_node(0, style).expect("style interns");
    let nodes = vec![FormattingNode {
        style: LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![text_item("dim", translucent, 0.0)],
        },
        children: Vec::new(),
    }];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("tree builds");
    let root = boxed_line(vec![text_run(0.0, 20.0, 0, 3)]);
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        &tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext::default(),
    )
    .expect("translucent text approximates to opaque ink");
    assert!(
        commands
            .iter()
            .any(|command| matches!(command, DisplayCommand::PaintText(_))),
        "the run still paints"
    );
}
