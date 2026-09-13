//! Box fragments: the transform wrapper around a subtree and the outside list marker.

use super::*;

#[test]
fn a_transformed_box_wraps_its_subtree_in_a_transform_state() {
    // The rotate wraps the whole subtree: pushState + transform about
    // the border-box center, the content, then popState.
    let fixture = two_color_flow(|red, _| vec![text_item("card", red, 0.0)]);
    let root = boxed_line(vec![text_run(0.0, 30.0, 0, 4)]);
    let mut node_paints = BTreeMap::new();
    node_paints.insert(
        0,
        NodePaint::Box {
            paint: ReaderBlockPaint::default(),
            border_box: None,
            transform: Some(vec![ReaderTransform::Rotate { radians: 0.05 }]),
            bevels: Vec::new(),
            segment_horizontal_edges: false,
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
            node_paints: Some(&node_paints),
            list_markers: None,
            ruby_annotation_runs: None,
            vertical_frame: None,
            flow_item_sources: None,
            ratio: 1.0,
        },
    )
    .expect("fragments paint");
    assert!(matches!(commands.first(), Some(DisplayCommand::PushState)));
    let Some(DisplayCommand::Transform {
        origin, transforms, ..
    }) = commands.get(1)
    else {
        panic!("expected a transform command, got {:?}", commands.get(1));
    };
    // Box rect is (10, 20, 100, 20): center (60, 30).
    assert_eq!(origin, &ReaderPoint { x: 60.0, y: 30.0 });
    assert_eq!(transforms, &vec![ReaderTransform::Rotate { radians: 0.05 }]);
    assert!(matches!(commands.last(), Some(DisplayCommand::PopState)));
    // The empty paint object strokes nothing: no paintBlock between.
    assert!(commands
        .iter()
        .all(|command| !matches!(command, DisplayCommand::PaintBlock { .. })));
    assert!(commands
        .iter()
        .any(|command| matches!(command, DisplayCommand::PaintText(_))));
}

/// An outside marker paints from the engine's measurement alone: its
/// box ends at the item's content edge, its clusters sit at the
/// measured origins, and the item's inline box paint never reaches
/// it.
#[test]
fn an_outside_marker_paints_its_measured_box_ending_at_the_content_edge() {
    let mut inline = InlineStyleTable::new(1);
    let mut item_style = body_style(srgb(0.0, 0.0, 0.0, 1.0));
    item_style.paint.background = srgb(1.0, 1.0, 0.0, 1.0).into();
    let style = inline
        .intern_for_node(0, item_style)
        .expect("item style interns");
    let tree = FormattingTree::with_styles(
        vec![FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::InlineFlow {
                items: vec![text_item("item", style, 0.0)],
            },
            children: Vec::new(),
        }],
        FormattingNodeId(0),
        FormattingTreeStyles {
            layout: LayoutStyleTable::new(0),
            inline,
        },
    )
    .expect("tree builds");
    let root = boxed_line(vec![text_run(0.0, 30.0, 0, 4)]);
    let mut markers = BTreeMap::new();
    markers.insert(
        0,
        crate::fragment_bridge::ListMarkerPaint {
            text: "3.".to_owned(),
            style,
            run: Some(rito_inline::MeasuredRun {
                advance: 16.0,
                clusters: vec![
                    rito_fragment::ClusterPosition { byte: 0, x: 0.0 },
                    rito_fragment::ClusterPosition { byte: 1, x: 8.0 },
                    rito_fragment::ClusterPosition { byte: 2, x: 12.0 },
                ],
                grid: false,
            }),
        },
    );
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        &tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext {
            list_markers: Some(&markers),
            ruby_annotation_runs: None,
            ..FragmentPaintContext::default()
        },
    )
    .expect("fragments paint");
    let texts: Vec<&DisplayTextCommand> = commands
        .iter()
        .filter_map(|command| match command {
            DisplayCommand::PaintText(input) => Some(input),
            _ => None,
        })
        .collect();
    assert_eq!(texts.len(), 2, "the marker and the item's text");
    let marker = texts[0];
    assert_eq!(
        marker.text, "3. ",
        "the marker paints before the item, with its trailing space"
    );
    // The item box starts at x = 10: the 16px marker box ends there.
    assert_eq!(marker.rect.x, -6.0);
    assert_eq!(marker.rect.width, 16.0);
    // The item's painted baseline: line top 26 plus baseline 13.
    assert_eq!(
        marker.clusters,
        vec![(0, -6.0, 39.0), (1, 2.0, 39.0), (2, 6.0, 39.0)]
    );
    assert!(
        !marker.paint.has_box_paint() && marker.paint.decoration.is_none(),
        "the item's background band stays off the marker"
    );
    assert!(
        texts[1].paint.has_box_paint(),
        "the item's own text keeps its inline box"
    );
}
