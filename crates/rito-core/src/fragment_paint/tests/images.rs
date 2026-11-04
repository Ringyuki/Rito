//! Inline images: the source reference and object-fit letterboxing.

use super::*;

fn painted_image_rect(
    intrinsic_width: f64,
    intrinsic_height: f64,
    object_fit: rito_style_contract::ObjectFit,
) -> ReaderRect {
    painted_image_rect_in(
        intrinsic_width,
        intrinsic_height,
        object_fit,
        FragmentRect {
            x: 5.0,
            y: 2.0,
            width: 40.0,
            height: 30.0,
        },
    )
    .expect("the image paints")
}

fn painted_image_rect_in(
    intrinsic_width: f64,
    intrinsic_height: f64,
    object_fit: rito_style_contract::ObjectFit,
    image_rect: FragmentRect,
) -> Option<ReaderRect> {
    painted_image_rect_framed(
        intrinsic_width,
        intrinsic_height,
        object_fit,
        image_rect,
        None,
    )
}

/// The rect an image at `image_rect` on a line paints at, the tree laid
/// out in `vertical_frame` when one is given.
fn painted_image_rect_framed(
    intrinsic_width: f64,
    intrinsic_height: f64,
    object_fit: rito_style_contract::ObjectFit,
    image_rect: FragmentRect,
    vertical_frame: Option<crate::fragment_paint::VerticalFrame>,
) -> Option<ReaderRect> {
    use rito_style_contract::{
        AlignItems, BoxSizing, Clear, CssPx, Float, JustifyContent, LayoutDisplay,
        LayoutDisplayInside, LayoutDisplayOutside, LayoutFormattingStyle, LengthPercentageOrAuto,
        ListMarkerStyle, MaximumSize, MinimumSize, NonNegativeLengthPercentage, Overflow,
        PageBreak, PhysicalSides, Position, PreferredSize,
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
                border_widths: rito_style_contract::PhysicalSides::uniform(
                    rito_style_contract::NonNegativeCssPx::ZERO,
                ),
                box_sizing: BoxSizing::ContentBox,
                justify_content: JustifyContent::Normal,
                align_items: AlignItems::Normal,
                break_before: PageBreak::Auto,
                break_after: PageBreak::Auto,
                width: PreferredSize::Auto,
                height: PreferredSize::Auto,
                max_width: MaximumSize::None,
                min_height: MinimumSize::Auto,
                min_width: MinimumSize::Auto,
                writing_mode: rito_style_contract::WritingMode::HorizontalTopToBottom,
                direction: rito_style_contract::Direction::LeftToRight,
                max_height: MaximumSize::None,
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
                align: rito_fragment::AtomAlign::Baseline,
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
        rect: image_rect,
        item_index: 0,
    })]);
    let mut commands = Vec::new();
    append_fragment_display_commands(
        &mut commands,
        &tree,
        &root,
        0.0,
        0.0,
        FragmentPaintContext {
            vertical_frame,
            ..FragmentPaintContext::default()
        },
    )
    .expect("fragments paint");
    assert!(
        commands.len() <= 1,
        "expected at most one command: {commands:?}"
    );
    commands.first().map(|command| {
        let DisplayCommand::PaintImage { src, rect, .. } = command else {
            panic!("expected an image command, got {command:?}");
        };
        assert_eq!(src, "images/portrait.png");
        *rect
    })
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
    // by 0.75 to 22.5x30, centered on the inline axis at 27.75, and the
    // placed rect snaps to whole pixels; the box (and its border and
    // background) keeps the author's rect.
    assert_eq!(
        painted_image_rect(30.0, 40.0, ObjectFit::Contain),
        display_rect(28.0, 28.0, 22.0, 30.0)
    );
}

#[test]
fn a_letterboxed_raster_snaps_where_contain_placed_it() {
    use rito_style_contract::ObjectFit;
    // A 723x1 rule declared 538395x1430 and scaled into a 626.6875 x
    // 1.6875 box at y 126.3125: contain places it on [126.72, 127.59),
    // which snaps to the one row [127, 128) the browser rasters it on
    // (snapping the box first left a 2px box and a half-pixel raster
    // smeared over two rows).
    assert_eq!(
        painted_image_rect_in(
            723.0,
            1.0,
            ObjectFit::Contain,
            FragmentRect {
                x: 5.0,
                y: 100.3125,
                width: 626.6875,
                height: 1.6875,
            },
        ),
        Some(display_rect(19.0, 127.0, 627.0, 1.0))
    );
}

#[test]
fn a_raster_contained_within_one_row_keeps_that_row() {
    use rito_style_contract::ObjectFit;
    // The same rule at y 126.125: contain places it on [126.54, 127.40),
    // whose edges both round to 127. The browser keeps a span longer than
    // four LayoutUnits at least one pixel, so the rule rasters on the row
    // its start rounds to instead of vanishing.
    assert_eq!(
        painted_image_rect_in(
            723.0,
            1.0,
            ObjectFit::Contain,
            FragmentRect {
                x: 5.0,
                y: 100.125,
                width: 626.6875,
                height: 1.6875,
            },
        ),
        Some(display_rect(19.0, 127.0, 627.0, 1.0))
    );
}

#[test]
fn a_raster_contained_to_a_sliver_paints_nothing() {
    use rito_style_contract::ObjectFit;
    // Contained to 1/32 px tall, the rule spans under four LayoutUnits:
    // its snapped rect is empty, and the browser draws nothing.
    assert_eq!(
        painted_image_rect_in(
            1000.0,
            1.0,
            ObjectFit::Contain,
            FragmentRect {
                x: 5.0,
                y: 100.0,
                width: 31.25,
                height: 4.0,
            },
        ),
        None
    );
}

#[test]
fn a_column_image_snaps_like_any_inline_image() {
    use rito_style_contract::ObjectFit;
    // Down a column the image's box comes back to physical terms and
    // paints as any inline image does, snapped to whole CSS pixels (the
    // browser rasters a plate centred at a .5 offset on the next row; the
    // raw rect smeared it across two). The column of the boxed line stands
    // at x 174, y 34: the image's box lands at (163.75, 44.5).
    let frame = crate::fragment_paint::VerticalFrame {
        converter: rito_fragment::WritingModeConverter::from_logical_size(
            rito_style_contract::WritingDirection {
                mode: rito_style_contract::WritingMode::VerticalRightToLeft,
                direction: rito_style_contract::Direction::LeftToRight,
            },
            100.0,
            220.0,
        ),
        left: 0.0,
        top: 20.0,
    };
    assert_eq!(
        painted_image_rect_framed(
            30.0,
            40.0,
            ObjectFit::Fill,
            FragmentRect {
                x: 10.5,
                y: 0.25,
                width: 40.0,
                height: 30.0,
            },
            Some(frame),
        ),
        Some(display_rect(164.0, 45.0, 30.0, 40.0))
    );
}
