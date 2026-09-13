//! Horizontal rules: the solid stroke and the inset two-tone border box.

use super::*;

#[test]
fn rule_paints_stroke_across_its_sized_box() {
    let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
    let rule = Fragment::Box(BoxFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x: 3.0,
            y: 7.0,
            width: 90.0,
            height: 2.0,
        },
        children: Vec::new(),
    });
    let root = Fragment::Box(BoxFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 30.0,
        },
        children: vec![rule],
    });
    let mut paints = std::collections::BTreeMap::new();
    paints.insert(
        0u32,
        NodePaint::Rule {
            color: css_color("#445566"),
            style: ReaderBorderStyle::Solid,
            thickness: 2.0,
        },
    );
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        &fixture.tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext {
            image_border_paints: None,
            family_policy: None,
            node_paints: Some(&paints),
            list_markers: None,
            ruby_annotation_runs: None,
            vertical_frame: None,
            flow_item_sources: None,
            ratio: 1.0,
        },
    )
    .expect("rule paints");
    // Both boxes share source node 0 in this fixture, so the outer box
    // also strokes; the inner rule is the second command.
    let DisplayCommand::PaintHorizontalRule { rect, paint } = &commands[1] else {
        panic!("expected a rule command, got {:?}", commands[1]);
    };
    assert_eq!(*rect, display_rect(13.0, 27.0, 90.0, 2.0));
    assert_eq!(paint.color, css_color("#445566"));
    assert_eq!(paint.style, ReaderBorderStyle::Solid);
}

/// An inset rule is the browser's fixed two-tone bevel closed on all
/// four sides: it paints as one border box — dark top and left, light
/// bottom and right — so the border lowering miters the corners where
/// the tones meet.
#[test]
fn an_inset_rule_paints_as_a_two_tone_border_box() {
    let fixture = two_color_flow(|red, _| vec![text_item("x", red, 0.0)]);
    let rule = Fragment::Box(BoxFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x: 3.0,
            y: 7.0,
            width: 90.0,
            height: 2.0,
        },
        children: Vec::new(),
    });
    let root = Fragment::Box(BoxFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x: 10.0,
            y: 20.0,
            width: 100.0,
            height: 30.0,
        },
        children: vec![rule],
    });
    let mut paints = std::collections::BTreeMap::new();
    paints.insert(
        0u32,
        NodePaint::Rule {
            color: css_color("#808080"),
            style: ReaderBorderStyle::Inset,
            thickness: 1.0,
        },
    );
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        &fixture.tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext {
            node_paints: Some(&paints),
            ..FragmentPaintContext::default()
        },
    )
    .expect("rule paints");
    // Both boxes share source node 0 in this fixture, so the outer box
    // paints first; the rule is the second command.
    let DisplayCommand::PaintBlock {
        rect,
        paint,
        border_box,
    } = &commands[1]
    else {
        panic!("expected a block command, got {:?}", commands[1]);
    };
    assert_eq!(*rect, display_rect(13.0, 27.0, 90.0, 2.0));
    let border = paint.border.expect("the bevel is a border box");
    for (side, edge, color) in [
        ("top", border.top, "#9a9a9a"),
        ("left", border.left, "#9a9a9a"),
        ("bottom", border.bottom, "#eeeeee"),
        ("right", border.right, "#eeeeee"),
    ] {
        let edge = edge.unwrap_or_else(|| panic!("{side} edge paints"));
        assert_eq!(edge.color, css_color(color), "{side}");
        assert_eq!(edge.style, ReaderBorderStyle::Solid, "{side}");
    }
    let widths = border_box.expect("border widths");
    for (key, width) in [
        ("top", widths.top_width),
        ("right", widths.right_width),
        ("bottom", widths.bottom_width),
        ("left", widths.left_width),
    ] {
        assert_eq!(width, 1.0, "{key}");
    }
}
