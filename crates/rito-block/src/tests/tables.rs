//! Tables: column sizing and border spacing on a whole table, and how
//! one breaks across fragmentainers.

use super::*;

/// Builds a tree whose root holds one table: `rows` gives, per row,
/// the paragraph line counts of each cell (single-line paragraphs
/// through `FixedLineInline`, so every count is 10 px of content).
fn table_tree(rows: &[&[&[usize]]]) -> FormattingTree {
    let mut inline = InlineStyleTable::new(1);
    let text_style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    let mut nodes: Vec<FormattingNode> = Vec::new();
    let mut row_ids = Vec::new();
    let mut node_total = 0usize;
    for row in rows {
        let mut cell_ids = Vec::new();
        for cell in *row {
            let mut paragraph_ids = Vec::new();
            for count in *cell {
                nodes.push(FormattingNode {
                    style: LayoutStyleId::from_raw(0),
                    content: FormattingNodeContent::InlineFlow {
                        items: (0..*count)
                            .map(|line| InlineItem::Text {
                                text: format!("line {line}"),
                                style: text_style,
                                baseline_shift_px: 0.0,
                                ruby_annotation: None,
                            })
                            .collect(),
                    },
                    children: Vec::new(),
                });
                paragraph_ids.push(FormattingNodeId(node_total as u32));
                node_total += 1;
            }
            nodes.push(FormattingNode {
                style: LayoutStyleId::from_raw(0),
                content: FormattingNodeContent::TableCell { col_span: 1 },
                children: paragraph_ids,
            });
            cell_ids.push(FormattingNodeId(node_total as u32));
            node_total += 1;
        }
        nodes.push(FormattingNode {
            style: LayoutStyleId::from_raw(0),
            content: FormattingNodeContent::TableRow,
            children: cell_ids,
        });
        row_ids.push(FormattingNodeId(node_total as u32));
        node_total += 1;
    }
    nodes.push(FormattingNode {
        style: LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::Table,
        children: row_ids,
    });
    let table_id = FormattingNodeId(node_total as u32);
    node_total += 1;
    nodes.push(FormattingNode {
        style: LayoutStyleId::from_raw(0),
        content: FormattingNodeContent::BlockContainer,
        children: vec![table_id],
    });
    let root = FormattingNodeId(node_total as u32);
    let mut layout = LayoutStyleTable::new(0);
    let plain = layout
        .intern(block_style(margin_px(0.0), margin_px(0.0)))
        .expect("style interns");
    assert_eq!(plain, LayoutStyleId::from_raw(0));
    FormattingTree::with_styles(nodes, root, FormattingTreeStyles { layout, inline })
        .expect("tree builds")
}

#[test]
fn border_spacing_wraps_the_single_row_once_per_side() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let mut inline = InlineStyleTable::new(1);
    let text_style = inline
        .intern_for_node(
            0,
            plain_paragraph_style(
                FontFamilies::new(vec![FontFamily::Named(FontFamilyName::new("Fixture"))])
                    .expect("family list"),
                16.0,
                0.0,
            ),
        )
        .expect("style interns");
    let mut spaced = block_style(margin_px(0.0), margin_px(0.0));
    spaced.border_spacing = (
        rito_style_contract::NonNegativeCssPx::new(2.0).expect("finite"),
        rito_style_contract::NonNegativeCssPx::new(2.0).expect("finite"),
    );
    let layout = layout_table_with(2, |index| match index {
        1 => spaced,
        _ => block_style(margin_px(0.0), margin_px(0.0)),
    });
    let nodes = vec![
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::InlineFlow {
                items: (0..6)
                    .map(|line| InlineItem::Text {
                        text: format!("line {line}"),
                        style: text_style,
                        baseline_shift_px: 0.0,
                        ruby_annotation: None,
                    })
                    .collect(),
            },
            children: Vec::new(),
        },
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::TableCell { col_span: 1 },
            children: vec![FormattingNodeId(0)],
        },
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::TableRow,
            children: vec![FormattingNodeId(1)],
        },
        FormattingNode {
            style: node_style_id(&layout, 1),
            content: FormattingNodeContent::Table,
            children: vec![FormattingNodeId(2)],
        },
        FormattingNode {
            style: node_style_id(&layout, 0),
            content: FormattingNodeContent::BlockContainer,
            children: vec![FormattingNodeId(3)],
        },
    ];
    let tree = FormattingTree::with_styles(
        nodes,
        FormattingNodeId(4),
        FormattingTreeStyles { layout, inline },
    )
    .expect("tree builds");
    let outcome = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(100.0),
            None,
            &CancelFlag::new(),
        )
        .expect("lays out");
    // Separate-borders model (measured on the b60 cards): the 2px
    // spacing separates the row from the table edge exactly once per
    // side — 60px of lines wrap to 64, never 68.
    let table = table_fragment(&outcome);
    assert!(
        (table.rect.height - 64.0).abs() < 1e-9,
        "spacing wraps once per side, got {}",
        table.rect.height
    );
}

fn table_fragment(outcome: &LayoutOutcome) -> &BoxFragment {
    let children = box_children(outcome);
    assert_eq!(children.len(), 1, "each page holds one table fragment");
    let Fragment::Box(table) = &children[0] else {
        panic!("table fragments are boxes");
    };
    table
}

#[test]
fn a_page_tall_single_cell_table_fragments_between_its_paragraphs() {
    let context = BlockFormattingContext::new(FixedLineInline);
    // One row, one cell, six single-line paragraphs (60 px) through
    // 25 px fragmentainers: the cell's content fragments like any
    // block flow — 2 + 2 + 2 paragraphs — instead of the table
    // deferring whole and clipping (the spider-TOC defect shape).
    let tree = table_tree(&[&[&[1, 1, 1, 1, 1, 1]]]);
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
    assert_eq!(pages.len(), 3);
    for page in &pages {
        let table = table_fragment(page);
        assert!(
            (table.rect.height - 20.0).abs() < 1e-9,
            "each table fragment holds two 10px paragraphs, got {}",
            table.rect.height
        );
        let Fragment::Box(row) = &table.children[0] else {
            panic!("row fragments are boxes");
        };
        let Fragment::Box(cell) = &row.children[0] else {
            panic!("cell fragments are boxes");
        };
        assert_eq!(cell.children.len(), 2);
        // Resumed fragments start flush at the fragmentainer top.
        assert!(table.rect.y.abs() < 1e-9);
        assert!(row.rect.y.abs() < 1e-9);
    }
}

#[test]
fn a_multi_cell_row_breaks_between_rows() {
    let context = BlockFormattingContext::new(FixedLineInline);
    // Three 10px rows of two cells each through 25 px fragmentainers:
    // multi-cell rows fragment between rows — 2 rows, then 1.
    let tree = table_tree(&[&[&[1], &[1]], &[&[1], &[1]], &[&[1], &[1]]]);
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
    assert_eq!(pages.len(), 2);
    let first = table_fragment(&pages[0]);
    assert_eq!(first.children.len(), 2);
    assert!((first.rect.height - 20.0).abs() < 1e-9);
    let second = table_fragment(&pages[1]);
    assert_eq!(second.children.len(), 1);
    assert!((second.rect.height - 10.0).abs() < 1e-9);
}

#[test]
fn a_fitting_table_places_whole_and_continuous_flow_never_fragments() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = table_tree(&[&[&[1, 1, 1, 1, 1, 1]]]);
    // Continuous flow: one whole 60px table.
    let continuous = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::continuous(100.0),
            None,
            &CancelFlag::new(),
        )
        .expect("lays out");
    assert!(continuous.continuation.is_none());
    assert!((table_fragment(&continuous).rect.height - 60.0).abs() < 1e-9);
    // A fragmentainer tall enough holds it whole too.
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 80.0));
    assert_eq!(pages.len(), 1);
    assert!((table_fragment(&pages[0]).rect.height - 60.0).abs() < 1e-9);
}
