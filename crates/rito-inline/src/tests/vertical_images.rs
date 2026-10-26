//! Physical image sizes under the logical axes of a vertical paragraph.
use super::*;

fn image_tree(vertical: bool, boxed: bool, image_style: LayoutFormattingStyle) -> FormattingTree {
    let mut inline = InlineStyleTable::new(1);
    let mut style = tinos_style(0.0);
    if vertical {
        style.bidi.writing_mode = WritingMode::VerticalRightToLeft;
    }
    let style = inline.intern_for_node(0, style).expect("inline style");
    let mut layout = LayoutStyleTable::new(2);
    let host_style = layout
        .intern_for_node(0, atoms_and_grid::jgap_image_layout_style())
        .expect("host style");
    let image_layout = layout.intern_for_node(1, image_style).expect("image style");
    let image = InlineItem::Image {
        src: "probe.png".to_owned(),
        source: 0,
        intrinsic_width: 48.0,
        intrinsic_height: 24.0,
        style,
        layout_style: image_layout,
        fit_contain: false,
        object_fit: rito_style_contract::ObjectFit::Fill,
        viewport: None,
        align_top: false,
        baseline_shift_px: 0.0,
    };
    let mut nodes = vec![FormattingNode {
        style: host_style,
        content: FormattingNodeContent::InlineFlow {
            items: vec![if boxed {
                InlineItem::InlineBlock {
                    node: FormattingNodeId(1),
                    style,
                    layout_style: host_style,
                    baseline_shift_px: 0.0,
                }
            } else {
                image.clone()
            }],
        },
        children: Vec::new(),
    }];
    if boxed {
        nodes.push(FormattingNode {
            style: host_style,
            content: FormattingNodeContent::InlineFlow { items: vec![image] },
            children: Vec::new(),
        });
    }
    let struts = (0..nodes.len()).map(|node| (node as u32, style)).collect();
    let mut tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(0),
        rito_fragment::FormattingTreeStyles { layout, inline },
    )
    .expect("tree");
    tree.set_strut_styles(struts);
    tree
}

fn fixed_size(width: f32, height: f32) -> LayoutFormattingStyle {
    let mut style = atoms_and_grid::jgap_image_layout_style();
    let fixed = |value| {
        PreferredSize::Value(NonNegativeLengthPercentage::new(LengthPercentage::Length(
            CssPx::new(value).expect("length"),
        )))
    };
    style.width = fixed(width);
    style.height = fixed(height);
    style
}

fn image_rect(
    context: &ParleyInlineContext,
    tree: &FormattingTree,
    space: ConstraintSpace,
) -> FragmentRect {
    fn find(fragment: &Fragment) -> Option<FragmentRect> {
        match fragment {
            Fragment::Image(image) => Some(image.rect),
            Fragment::Box(box_) => box_.children.iter().find_map(find),
            Fragment::Line(line) => line.children.iter().find_map(find),
            _ => None,
        }
    }
    let outcome = context
        .layout(tree, tree.root(), &space, None, &CancelFlag::new())
        .expect("layout");
    find(&outcome.fragments.root).expect("image fragment")
}

fn assert_size(rect: FragmentRect, width: f64, height: f64) {
    assert!(
        (rect.width - width).abs() < 1.0 / 64.0,
        "width {rect:?}, expected {width}"
    );
    assert!(
        (rect.height - height).abs() < 1.0 / 64.0,
        "height {rect:?}, expected {height}"
    );
}

#[test]
fn vertical_boxed_landscape_image_keeps_author_dimensions() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context");
    for vertical in [false, true] {
        for boxed in [false, true] {
            let tree = image_tree(vertical, boxed, fixed_size(30.0, 20.0));
            for inline in [200.0, 120.0, 200.0] {
                let rect = image_rect(&context, &tree, ConstraintSpace::continuous(inline));
                let (width, height) = if vertical { (20.0, 30.0) } else { (30.0, 20.0) };
                assert_size(rect, width, height);
            }
        }
    }
}

#[test]
fn vertical_image_page_clamp_uses_physical_axes() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context");
    for vertical in [true, false] {
        for (width, height) in [(320.0, 180.0), (20.0, 300.0), (180.0, 320.0)] {
            for boxed in [false, true] {
                let tree = image_tree(vertical, boxed, fixed_size(width, height));
                for (physical_width, physical_height) in
                    [(100.0, 200.0), (80.0, 120.0), (100.0, 200.0)]
                {
                    let rect = image_rect(
                        &context,
                        &tree,
                        ConstraintSpace {
                            fragmentainer_size: Some(if vertical {
                                physical_width
                            } else {
                                physical_height
                            }),
                            ..ConstraintSpace::continuous(if vertical {
                                physical_height
                            } else {
                                physical_width
                            })
                        },
                    );
                    let scale = (physical_width / f64::from(width))
                        .min(physical_height / f64::from(height))
                        .min(1.0);
                    let (inline, block) = if vertical {
                        (height, width)
                    } else {
                        (width, height)
                    };
                    assert_size(rect, f64::from(inline) * scale, f64::from(block) * scale);
                }
            }
        }
    }
}

#[test]
fn vertical_image_percentage_width_uses_physical_width() {
    let context = ParleyInlineContext::new(vec![tinos_bytes()]).expect("context");
    let mut style = atoms_and_grid::jgap_image_layout_style();
    style.width = PreferredSize::Value(NonNegativeLengthPercentage::new(
        LengthPercentage::Percentage(
            rito_style_contract::Percentage::from_ratio(0.5).expect("ratio"),
        ),
    ));
    let tree = image_tree(true, false, style);
    for (physical_width, physical_height) in [(100.0, 200.0), (80.0, 120.0), (100.0, 200.0)] {
        let rect = image_rect(
            &context,
            &tree,
            ConstraintSpace {
                fragmentainer_size: Some(physical_width),
                ..ConstraintSpace::continuous(physical_height)
            },
        );
        assert_size(rect, physical_width / 4.0, physical_width / 2.0);
    }
}
