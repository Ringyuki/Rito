//! Tables: column sizing and border spacing on a whole table, and how
//! one breaks across fragmentainers.

use super::*;

/// Builds a tree whose root holds one table: `rows` gives, per row,
/// the paragraph line counts of each cell (single-line paragraphs
/// through `FixedLineInline`, so every count is 10 px of content).
fn table_tree(rows: &[&[&[usize]]]) -> FormattingTree {
    table_tree_with_rowspans(rows, &[])
}

fn table_tree_with_rowspans(rows: &[&[&[usize]]], spans: &[(usize, usize, u32)]) -> FormattingTree {
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
    for (row_index, row) in rows.iter().enumerate() {
        let mut cell_ids = Vec::new();
        for (cell_index, cell) in row.iter().enumerate() {
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
                content: FormattingNodeContent::TableCell {
                    col_span: 1,
                    row_span: spans
                        .iter()
                        .find(|(r, c, _)| *r == row_index && *c == cell_index)
                        .map_or(1, |(_, _, s)| *s),
                },
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
            content: FormattingNodeContent::TableCell {
                col_span: 1,
                row_span: 1,
            },
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

#[test]
fn rowspan_group_moves_as_a_unit_and_column_occupancy_survives_the_break() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = table_tree_with_rowspans(&[&[&[2], &[1]], &[&[1]], &[&[1], &[1]]], &[(0, 0, 2)]);
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
    assert_eq!(pages.len(), 2);
    let first = table_fragment(&pages[0]);
    let second = table_fragment(&pages[1]);
    assert_eq!(first.children.len(), 2);
    assert_eq!(second.children.len(), 1);
    assert!((first.rect.height - 20.0).abs() < 1e-9);
    let Fragment::Box(first_row) = &first.children[0] else {
        panic!("row")
    };
    let Fragment::Box(second_row) = &first.children[1] else {
        panic!("row")
    };
    let Fragment::Box(span) = &first_row.children[0] else {
        panic!("cell")
    };
    let Fragment::Box(upper) = &first_row.children[1] else {
        panic!("cell")
    };
    let Fragment::Box(lower) = &second_row.children[0] else {
        panic!("cell")
    };
    assert_eq!(span.rect.height, 20.0);
    assert_eq!(upper.rect.x, lower.rect.x);
    assert!(lower.rect.x >= span.rect.x + span.rect.width);
}

#[test]
fn rowspan_table_preserves_fragmentation_of_an_unrelated_tall_single_cell_row() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = table_tree_with_rowspans(
        &[&[&[1], &[1]], &[&[1]], &[&[1, 1, 1, 1, 1, 1]]],
        &[(0, 0, 2)],
    );
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
    assert_eq!(
        pages.len(),
        4,
        "20px group, then three fragments of the 60px cell"
    );
    fn lines(fragment: &Fragment) -> usize {
        match fragment {
            Fragment::Box(b) => b.children.iter().map(lines).sum(),
            Fragment::Line(_) => 1,
            _ => 0,
        }
    }
    assert_eq!(
        pages
            .iter()
            .map(|p| lines(&p.fragments.root))
            .sum::<usize>(),
        9
    );
    assert!(pages.iter().all(|p| table_fragment(p).rect.height <= 25.0));
}

#[test]
fn rowspan_participates_in_the_formatting_tree_fingerprint() {
    let rows: &[&[&[usize]]] = &[&[&[1], &[1]], &[&[1]]];
    let first = table_tree_with_rowspans(rows, &[(0, 0, 1)]);
    let spanning = table_tree_with_rowspans(rows, &[(0, 0, 2)]);
    assert_ne!(first.fingerprint(), spanning.fingerprint());
}

#[test]
fn rowspan_taller_than_a_page_fragments_without_lost_or_repeated_lines() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let owned: Vec<Vec<Vec<usize>>> = (0..30)
        .map(|row| {
            if row == 0 {
                vec![vec![1], vec![1]]
            } else {
                vec![vec![1]]
            }
        })
        .collect();
    let cells: Vec<Vec<&[usize]>> = owned
        .iter()
        .map(|row| row.iter().map(Vec::as_slice).collect())
        .collect();
    let rows: Vec<&[&[usize]]> = cells.iter().map(Vec::as_slice).collect();
    let tree = table_tree_with_rowspans(&rows, &[(0, 0, 30)]);
    let pages = paginate(&context, &tree, ConstraintSpace::fragmented(100.0, 25.0));
    assert_eq!(pages.len(), 15, "two 10px rows per page");
    fn collect(fragment: &Fragment, parent_y: f64, seen: &mut std::collections::BTreeSet<u32>) {
        match fragment {
            Fragment::Box(b) => {
                for child in &b.children {
                    collect(child, parent_y + b.rect.y, seen);
                }
            }
            Fragment::Line(line) => {
                let top = parent_y + line.rect.y;
                assert!(
                    top >= -1e-7 && top + line.rect.height <= 25.0 + 1e-7,
                    "line outside page: {top}"
                );
                assert!(
                    seen.insert(line.source.0),
                    "a source paragraph appeared twice"
                );
            }
            _ => {}
        }
    }
    let mut seen = std::collections::BTreeSet::new();
    for page in &pages {
        collect(&page.fragments.root, 0.0, &mut seen);
    }
    assert_eq!(
        seen.len(),
        31,
        "the spanning cell and every ordinary row remain readable"
    );
}

#[test]
fn rowspan_reports_an_indivisible_line_instead_of_silently_clipping_it() {
    let context = BlockFormattingContext::new(FixedLineInline);
    let tree = table_tree_with_rowspans(&[&[&[1], &[1]], &[&[1]]], &[(0, 0, 2)]);
    let error = context
        .layout(
            &tree,
            tree.root(),
            &ConstraintSpace::fragmented(100.0, 5.0),
            None,
            &CancelFlag::new(),
        )
        .expect_err("a 10px line cannot fit a 5px page");
    assert!(
        matches!(error, LayoutError::Invalid(message) if message.contains("indivisible line or image"))
    );
}

#[test]
fn parallel_cell_continuation_survives_serialization_and_a_fresh_context() {
    struct DifferentLineHeights;
    impl FormattingContext for DifferentLineHeights {
        fn layout(
            &self,
            tree: &FormattingTree,
            node: FormattingNodeId,
            space: &ConstraintSpace,
            token: Option<&BreakToken>,
            cancel: &CancelFlag,
        ) -> Result<LayoutOutcome, LayoutError> {
            let mut outcome = FixedLineInline.layout(tree, node, space, token, cancel)?;
            if node == FormattingNodeId(0) {
                let Fragment::Box(root) = &mut outcome.fragments.root else {
                    unreachable!()
                };
                root.rect.height = root.children.len() as f64 * 7.0;
                for (index, child) in root.children.iter_mut().enumerate() {
                    let Fragment::Line(line) = child else {
                        unreachable!()
                    };
                    line.rect.y = index as f64 * 7.0;
                    line.rect.height = 7.0;
                    line.baseline = 5.0;
                }
            }
            Ok(outcome)
        }
        fn intrinsic_inline_sizes(
            &self,
            tree: &FormattingTree,
            node: FormattingNodeId,
        ) -> Result<IntrinsicInlineSizes, LayoutError> {
            FixedLineInline.intrinsic_inline_sizes(tree, node)
        }
    }
    let owned: Vec<Vec<Vec<usize>>> = (0..30)
        .map(|row| {
            if row == 0 {
                vec![vec![30], vec![1]]
            } else {
                vec![vec![1]]
            }
        })
        .collect();
    let cells: Vec<Vec<&[usize]>> = owned
        .iter()
        .map(|row| row.iter().map(Vec::as_slice).collect())
        .collect();
    let rows: Vec<&[&[usize]]> = cells.iter().map(Vec::as_slice).collect();
    let tree = table_tree_with_rowspans(&rows, &[(0, 0, 30)]);
    let warm = BlockFormattingContext::new(DifferentLineHeights);
    let space = ConstraintSpace::fragmented(100.0, 25.0);
    let cancel = CancelFlag::new();
    let mut token = None;
    let mut counts = [0, 0];
    let mut used_cell_state = false;
    fn count(fragment: &Fragment, parent_y: f64, counts: &mut [usize; 2]) {
        match fragment {
            Fragment::Box(root) => {
                for child in &root.children {
                    count(child, parent_y + root.rect.y, counts)
                }
            }
            Fragment::Line(line) => {
                let top = parent_y + line.rect.y;
                assert!(top >= -1e-7 && top + line.rect.height <= 25.0 + 1e-7);
                counts[usize::from(line.source != FormattingNodeId(0))] += 1;
            }
            _ => {}
        }
    }
    for page in 0..64 {
        let fresh = BlockFormattingContext::new(DifferentLineHeights);
        let outcome = fresh
            .layout(&tree, tree.root(), &space, token.as_ref(), &cancel)
            .expect("fresh context resumes");
        assert_eq!(
            warm.layout(&tree, tree.root(), &space, token.as_ref(), &cancel)
                .expect("warm context"),
            outcome
        );
        count(&outcome.fragments.root, 0.0, &mut counts);
        let decoded =
            rito_fragment::decode_layout_outcome(&rito_fragment::encode_layout_outcome(&outcome))
                .expect("serialized continuation");
        assert_eq!(decoded, outcome);
        token = decoded.continuation;
        let Some(next) = &token else {
            assert_eq!(counts, [30, 30]);
            assert!(used_cell_state);
            assert_eq!(
                page + 1,
                15,
                "free span height must absorb inserted gaps without blank tail pages"
            );
            return;
        };
        used_cell_state |= next
            .spanning_table
            .as_ref()
            .is_some_and(|state| !state.insertions.is_empty());
        assert!(page < 63, "parallel cells must finish");
    }
}
