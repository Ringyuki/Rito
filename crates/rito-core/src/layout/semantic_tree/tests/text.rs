use serde_json::json;

use super::fixtures::{block, exact_flow, exact_lines, exact_text, line_at};
use crate::layout::{line::LineRun, page::RuntimePage, semantic_tree::build_page_semantic_tree};

#[test]
fn restores_soft_wrap_whitespace_from_the_shared_logical_flow() {
    let node = semantic_node(exact_lines("one two", 24.0));

    assert_eq!(node.children.len(), 2, "fixture must soft-wrap");
    assert_eq!(node.text.as_deref(), Some("one two"));
    assert_eq!(child_text(&node), "one two");
    assert_eq!(node.children[1].text.as_deref(), Some(" two"));
}

#[test]
fn does_not_invent_whitespace_at_a_cjk_soft_wrap() {
    let node = semantic_node(exact_lines("你好，世界", 20.0));

    assert!(node.children.len() > 1, "fixture must soft-wrap");
    assert_eq!(node.text.as_deref(), Some("你好，世界"));
    assert_eq!(child_text(&node), "你好，世界");
    assert!(node.children.iter().all(|child| !child
        .text
        .as_deref()
        .unwrap_or_default()
        .starts_with(' ')));
}

#[test]
fn restores_a_forced_break_from_the_shared_logical_flow() {
    let node = semantic_node(exact_lines("a\nb", 200.0));

    assert_eq!(node.children.len(), 2, "fixture must force-wrap");
    assert_eq!(node.text.as_deref(), Some("a\nb"));
    assert_eq!(child_text(&node), "a\nb");
    assert_eq!(node.children[1].text.as_deref(), Some("\nb"));
}

#[test]
fn does_not_reintroduce_an_unpainted_non_whitespace_gap() {
    let flow = exact_flow("abc");
    let node = semantic_node(vec![line_at(
        0.0,
        0.0,
        vec![exact_text("a", &flow, 0, 1), exact_text("c", &flow, 2, 3)],
    )]);

    assert_eq!(node.text.as_deref(), Some("ac"));
    assert_eq!(child_text(&node), "ac");
}

#[test]
fn excludes_fully_clipped_direct_runs_from_children_and_aggregate_text() {
    let flow = exact_flow("visible hidden");
    let mut hidden = exact_text("hidden", &flow, 8, 14);
    let LineRun::Text(hidden_run) = &mut hidden else {
        unreachable!();
    };
    hidden_run.x = 200.0;
    let mut paragraph = block(
        "p",
        0.0,
        0.0,
        vec![
            line_at(0.0, 0.0, vec![exact_text("visible", &flow, 0, 7)]),
            line_at(0.0, 18.0, vec![hidden]),
        ],
    );
    paragraph.width = 100.0;
    paragraph.height = 40.0;
    paragraph.paint = Some(json!({ "clipToBounds": true }));
    let page = RuntimePage::new(0, 400.0, 600.0, None, vec![paragraph]);

    let nodes = build_page_semantic_tree(&page);
    let node = &nodes[0];

    assert_eq!(node.text.as_deref(), Some("visible"));
    assert_eq!(node.children.len(), 1);
    assert_eq!(child_text(node), "visible");
}

fn semantic_node(
    children: Vec<crate::layout::content::RuntimeChild<crate::layout::line::LineBox>>,
) -> crate::layout::semantic_tree::LayoutSemanticNode {
    let page = RuntimePage::new(0, 400.0, 600.0, None, vec![block("p", 0.0, 0.0, children)]);
    build_page_semantic_tree(&page)
        .into_iter()
        .next()
        .expect("semantic paragraph")
}

fn child_text(node: &crate::layout::semantic_tree::LayoutSemanticNode) -> String {
    node.children
        .iter()
        .filter_map(|child| child.text.as_deref())
        .collect()
}
