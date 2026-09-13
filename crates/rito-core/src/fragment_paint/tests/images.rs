//! Inline images: the source reference and object-fit letterboxing.

use super::*;

fn painted_image_rect(
    intrinsic_width: f64,
    intrinsic_height: f64,
    object_fit: rito_style_contract::ObjectFit,
) -> ReaderRect {
    use rito_style_contract::{
        AlignItems, BoxSizing, Clear, CssPx, Float, JustifyContent, LayoutDisplay,
        LayoutDisplayInside, LayoutDisplayOutside, LayoutFormattingStyle, LengthPercentageOrAuto,
        ListMarkerStyle, MaximumHeight, MaximumSize, MinimumHeight, NonNegativeLengthPercentage,
        Overflow, PageBreak, PhysicalSides, Position, PreferredSize,
    };
    let mut inline = InlineStyleTable::new(1);
    let text_style = inline
        .intern_for_node(0, body_style(srgb(0.0, 0.0, 0.0, 1.0)))
        .expect("style interns");
    let zero_padding = NonNegativeLengthPercentage::new(LengthPercentage::Length(
        CssPx::new(0.0).expect("zero length"),
    ));
    let sides = |value| PhysicalSides {
        top: value,
        right: value,
        bottom: value,
        left: value,
    };
    let mut layout = LayoutStyleTable::new(1);
    let image_layout = layout
        .intern_for_node(
            0,
            LayoutFormattingStyle {
                display: LayoutDisplay {
                    outside: LayoutDisplayOutside::Inline,
                    inside: LayoutDisplayInside::Flow,
                    is_list_item: false,
                },
                margin: sides(LengthPercentageOrAuto::Auto),
                padding: PhysicalSides {
                    top: zero_padding,
                    right: zero_padding,
                    bottom: zero_padding,
                    left: zero_padding,
                },
                box_sizing: BoxSizing::ContentBox,
                justify_content: JustifyContent::Normal,
                align_items: AlignItems::Normal,
                break_before: PageBreak::Auto,
                break_after: PageBreak::Auto,
                width: PreferredSize::Auto,
                height: PreferredSize::Auto,
                max_width: MaximumSize::None,
                min_height: MinimumHeight::Auto,
                max_height: MaximumHeight::None,
                clear: Clear::None,
                float: Float::None,
                overflow: Overflow::Visible,
                list_style_type: ListMarkerStyle::None,
                position: Position::Static,
                inset: sides(LengthPercentageOrAuto::Auto),
                vertical_align: rito_style_contract::CellVerticalAlign::Baseline,
                border_spacing: (
                    rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                    rito_style_contract::NonNegativeCssPx::new(0.0).expect("zero"),
                ),
                border_collapse: false,
                object_fit: rito_style_contract::ObjectFit::Fill,
            },
        )
        .expect("layout style interns");
    let nodes = vec![FormattingNode {
        style: LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::InlineFlow {
            items: vec![InlineItem::Image {
                source: 0,
                src: "images/portrait.png".to_owned(),
                intrinsic_width,
                intrinsic_height,
                style: text_style,
                layout_style: image_layout,
                fit_contain: false,
                viewport: None,
                baseline_shift_px: 0.0,
                align_top: false,
                object_fit,
            }],
        },
        children: Vec::new(),
    }];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let root = boxed_line(vec![Fragment::Image(ImageFragment {
        source: FormattingNodeId(0),
        rect: FragmentRect {
            x: 5.0,
            y: 2.0,
            width: 40.0,
            height: 30.0,
        },
        item_index: 0,
    })]);
    let commands = paint(&tree, &root);
    assert_eq!(commands.len(), 1);
    let DisplayCommand::PaintImage { src, rect, .. } = &commands[0] else {
        panic!("expected an image command, got {:?}", commands[0]);
    };
    assert_eq!(src, "images/portrait.png");
    *rect
}

#[test]
fn images_paint_with_their_source_reference() {
    use rito_style_contract::ObjectFit;
    assert_eq!(
        painted_image_rect(40.0, 30.0, ObjectFit::Fill),
        display_rect(19.0, 28.0, 40.0, 30.0)
    );
}

#[test]
fn a_ratio_true_box_paints_identically_under_object_fit_contain() {
    use rito_style_contract::ObjectFit;
    // The guard band: contain equals fill when the box already has
    // the raster ratio, bit for bit.
    assert_eq!(
        painted_image_rect(40.0, 30.0, ObjectFit::Contain),
        display_rect(19.0, 28.0, 40.0, 30.0)
    );
}

#[test]
fn an_author_box_off_the_raster_ratio_letterboxes_under_contain() {
    use rito_style_contract::ObjectFit;
    // A portrait 30x40 raster inside the landscape 40x30 box scales
    // by 0.75 to 22.5x30, centered on the inline axis; the box (and
    // its border and background) keeps the author's rect.
    assert_eq!(
        painted_image_rect(30.0, 40.0, ObjectFit::Contain),
        display_rect(27.75, 28.0, 22.5, 30.0)
    );
}
