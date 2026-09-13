//! Box paint tests: horizontal rules, decorated blocks with absorbed border
//! widths, border styles reaching the painter, and table borders and
//! column sizing.

use super::*;

#[test]
fn horizontal_rules_build_sized_leaves_with_rule_paint() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <hr class="fancy"/>
  <hr/>
</body></html>"#,
        "html { color: #223344; }\n.fancy { border-top: 2px dashed #336699; }\n",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("rules build");
    let root = built.tree.node(built.tree.root());
    assert_eq!(root.children.len(), 2);
    let fancy = built.tree.node(root.children[0]);
    assert!(matches!(
        fancy.content,
        FormattingNodeContent::SizedLeaf {
            block_size,
            breakable: false,
        } if block_size == 2.0
    ));
    assert_eq!(
        built.node_paints.get(&root.children[0].0),
        Some(&NodePaint::Rule {
            color: css_color("#336699"),
            style: ReaderBorderStyle::Dashed,
            thickness: 2.0,
        }),
    );
    // A bare <hr> keeps the UA `border: 1px inset` pair: a two-pixel
    // flow box whose stroke is the fixed bevel (the color rides along
    // but the inset paint ignores it).
    let plain = built.tree.node(root.children[1]);
    assert!(matches!(
        plain.content,
        FormattingNodeContent::SizedLeaf {
            block_size,
            breakable: false,
        } if block_size == 2.0
    ));
    assert_eq!(
        built.node_paints.get(&root.children[1].0),
        Some(&NodePaint::Rule {
            color: css_color("#223344"),
            style: ReaderBorderStyle::Inset,
            thickness: 1.0,
        }),
    );
}

#[test]
fn decorated_blocks_carry_box_paint_and_absorb_border_widths() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="card"><p>Inside the card.</p></div>
</body></html>"#,
        ".card { background-color: #112233; border: 2px solid #445566; padding: 4px; }\n",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("decorated block builds");
    let root = built.tree.node(built.tree.root());
    let card_id = root.children[0];
    let card = built.tree.node(card_id);
    // Border widths absorbed into padding: 4px author padding + 2px border.
    let styles = built.tree.styles().expect("tree carries styles");
    let card_style = styles
        .layout
        .style(card.style)
        .expect("card style resolves");
    for side in [
        card_style.padding.top,
        card_style.padding.right,
        card_style.padding.bottom,
        card_style.padding.left,
    ] {
        let LengthPercentage::Length(px) = side.value() else {
            panic!("card padding stays a length");
        };
        assert!(
            (f64::from(px.get()) - 6.0).abs() < 1e-6,
            "padding absorbs the border"
        );
    }
    let Some(NodePaint::Box {
        paint, border_box, ..
    }) = built.node_paints.get(&card_id.0)
    else {
        panic!(
            "card carries box paint, got {:?}",
            built.node_paints.get(&card_id.0)
        );
    };
    let background = paint
        .background
        .as_ref()
        .expect("the card fills its background");
    assert_eq!(background.color, Some(css_color("#112233")));
    let border = paint.border.expect("the card strokes its border");
    assert_eq!(
        border.top.map(|edge| edge.style),
        Some(ReaderBorderStyle::Solid)
    );
    assert_eq!(
        border.left.map(|edge| edge.color),
        Some(css_color("#445566"))
    );
    let widths = border_box.expect("borders carry a border box");
    assert_eq!(widths.top_width, 2.0);
}

/// An over-constrained table's used column widths sit on the
/// LayoutUnit grid with the remainder in the LAST column (measured
/// on the b11 character card: 45.734375 / 13.6875 gaps repeat to
/// the 1/64 and the last column takes width - Σ = 45.78125; the
/// float distribution leaked dust into every column and a
/// non-square portrait in the last column scaled 3/64 short).
#[test]
fn over_constrained_table_columns_land_on_the_layout_unit_grid() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<table><tr>
  <td style="width:49.5px">a</td>
  <td style="width:13.5px"></td>
  <td style="width:49.5px">b</td>
  <td style="width:13.5px"></td>
  <td style="width:49.5px">c</td>
  <td style="width:13.5px"></td>
  <td style="width:49.5px">d</td>
</tr></table>
</body></html>"#,
        "body { margin: 0; padding: 0; } table { border-collapse: collapse; width: 229.5px; } td { padding: 0; font-size: 4px; }\n",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes(), source_han_test_bytes()])
            .expect("fonts register"),
    );
    let outcome = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(640.0),
            None,
            &CancelFlag::new(),
        )
        .expect("lays out");
    fn cells(fragment: &Fragment, off: f64, out: &mut Vec<(f64, f64)>, depth: usize) {
        if let Fragment::Box(node) = fragment {
            if depth == 3 {
                out.push((off + node.rect.x, node.rect.width));
                return;
            }
            for child in &node.children {
                cells(child, off + node.rect.x, out, depth + 1);
            }
        }
    }
    let mut xs = Vec::new();
    cells(&outcome.fragments.root, 0.0, &mut xs, 0);
    assert_eq!(xs.len(), 7, "seven cells lay out: {xs:?}");
    for (index, (x, _)) in xs.iter().enumerate() {
        let on_grid = (x * 64.0).round() / 64.0;
        assert!(
            (x - on_grid).abs() < 1e-9,
            "cell {index} x sits on the 1/64 grid: {x}"
        );
    }
    let last_end = xs[6].0 + xs[6].1;
    assert!(
        (last_end - 229.5).abs() < 1e-6,
        "the last column absorbs the remainder to the table edge: {last_end}"
    );
}

#[test]
fn a_collapsed_table_marks_its_horizontal_edges_for_segmentation() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <table class="bc"><tr><td>A</td><td>B</td></tr></table>
  <table class="sep"><tr><td>A</td><td>B</td></tr></table>
</body></html>"#,
        ".bc { border-collapse: collapse; border-bottom: dotted 3px #ED0286; }\n.sep { border-bottom: dotted 3px #ED0286; }\n",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tables build");
    let root = built.tree.node(built.tree.root());
    let mut flags = Vec::new();
    for child in &root.children {
        if let Some(NodePaint::Box {
            segment_horizontal_edges,
            ..
        }) = built.node_paints.get(&child.0)
        {
            flags.push(*segment_horizontal_edges);
        }
    }
    assert_eq!(
        flags,
        vec![true, false],
        "only the collapsed table segments its horizontal edges"
    );
}

#[test]
fn double_border_style_reaches_the_painter() {
    // Two 1px lines with a 1px gap at `medium` — the painter renders
    // the pair itself, so the bridge must pass the style through
    // (mapped to solid, b51's message frame filled the gap row).
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="frame"><p>text</p></div>
</body></html>"#,
        ".frame { border: 3px double #000000; }\n",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("double borders build");
    let root = built.tree.node(built.tree.root());
    let Some(NodePaint::Box { paint, .. }) = built.node_paints.get(&root.children[0].0) else {
        panic!("the frame still paints its border");
    };
    assert_eq!(
        paint
            .border
            .and_then(|border| border.top)
            .map(|edge| edge.style),
        Some(ReaderBorderStyle::Double)
    );
    assert!(
        !built
            .degradations
            .iter()
            .any(|reason| reason.contains("drawn solid")),
        "no approximation recorded: {:?}",
        built.degradations
    );
}

#[test]
fn ridge_borders_split_into_measured_two_tone_halves() {
    let chapter = resolved_chapter_with(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
  <div class="frame"><p>text</p></div>
</body></html>"#,
        ".frame { border-top: 6px ridge #4682b4; border-right: 6px groove #4682b4; }\n",
    );
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("ridge borders build");
    let root = built.tree.node(built.tree.root());
    let Some(NodePaint::Box { paint, bevels, .. }) = built.node_paints.get(&root.children[0].0)
    else {
        panic!("the frame paints its border");
    };
    // Ridge top: outer keeps steelblue, inner darkens (V - 0.33
    // scaling, probed #254560). Groove right inverts: outer stays
    // base, the dark half hugs the content.
    let border = paint.border.expect("the frame strokes its border");
    assert_eq!(
        border.top.map(|edge| edge.style),
        Some(ReaderBorderStyle::Solid)
    );
    assert_eq!(
        border.top.map(|edge| edge.color),
        Some(css_color("#4682b4"))
    );
    assert_eq!(
        border.right.map(|edge| edge.color),
        Some(css_color("#4682b4"))
    );
    assert_eq!(
        bevels.as_slice(),
        &[(0, css_color("#254560")), (1, css_color("#254560"))]
    );
    assert!(
        !built
            .degradations
            .iter()
            .any(|reason| reason.contains("drawn solid")),
        "two-tone edges are exact, not degraded: {:?}",
        built.degradations
    );
}
