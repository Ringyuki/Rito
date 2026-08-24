use serde_json::json;

mod fixtures;
mod roles;
mod text;

use fixtures::{assert_rect, atom, block, line, line_at, text, text_at};

use super::{build_page_semantic_tree, LayoutSemanticRole};
use crate::layout::{
    content::{RuntimeChild, RuntimeImage},
    line::{LineRun, RubyRunBox},
    page::RuntimePage,
    RunPaint,
};

#[test]
fn builds_nested_semantics_in_retained_layout_order() {
    let page = RuntimePage::new(
        0,
        400.0,
        600.0,
        None,
        vec![
            block("h2", 0.0, 0.0, vec![line(vec![text("Title", None)])]),
            block(
                "blockquote",
                0.0,
                40.0,
                vec![line(vec![text("Quote", None)])],
            ),
            block(
                "ul",
                0.0,
                80.0,
                vec![RuntimeChild::Block(Box::new(block(
                    "li",
                    10.0,
                    0.0,
                    vec![line(vec![text("Item", None)])],
                )))],
            ),
            block("table", 0.0, 120.0, Vec::new()),
            block(
                "p",
                0.0,
                160.0,
                vec![
                    line(vec![text("Before ", None), text("link", Some("#target"))]),
                    RuntimeChild::Image(RuntimeImage {
                        x: 0.0,
                        y: 24.0,
                        width: 20.0,
                        height: 20.0,
                        src: "standalone.png".to_owned(),
                        alt: Some("Standalone".to_owned()),
                        href: None,
                    }),
                    RuntimeChild::Image(RuntimeImage {
                        x: 24.0,
                        y: 24.0,
                        width: 20.0,
                        height: 20.0,
                        src: "linked.png".to_owned(),
                        alt: Some("Linked".to_owned()),
                        href: Some("chapter.xhtml#image".to_owned()),
                    }),
                ],
            ),
            block("section", 0.0, 220.0, Vec::new()),
        ],
    );

    let nodes = build_page_semantic_tree(&page);

    assert_eq!(
        nodes.iter().map(|node| node.role).collect::<Vec<_>>(),
        vec![
            LayoutSemanticRole::Heading,
            LayoutSemanticRole::Blockquote,
            LayoutSemanticRole::List,
            LayoutSemanticRole::Table,
            LayoutSemanticRole::Paragraph,
            LayoutSemanticRole::Generic,
        ]
    );
    assert_eq!(nodes[0].level, Some(2));
    assert_eq!(nodes[0].text.as_deref(), Some("Title"));
    assert_eq!(nodes[2].children[0].role, LayoutSemanticRole::ListItem);
    assert_eq!(nodes[2].children[0].text.as_deref(), Some("Item"));

    let paragraph = &nodes[4];
    assert_eq!(paragraph.text.as_deref(), Some("Before link"));
    assert_eq!(
        paragraph
            .children
            .iter()
            .map(|node| node.role)
            .collect::<Vec<_>>(),
        vec![
            LayoutSemanticRole::Generic,
            LayoutSemanticRole::Link,
            LayoutSemanticRole::Image,
            LayoutSemanticRole::Link,
        ]
    );
    assert_eq!(paragraph.children[0].text.as_deref(), Some("Before "));
    assert_eq!(paragraph.children[1].href.as_deref(), Some("#target"));
    assert_eq!(paragraph.children[2].alt.as_deref(), Some("Standalone"));
    let linked_image = &paragraph.children[3];
    assert_eq!(linked_image.href.as_deref(), Some("chapter.xhtml#image"));
    assert_eq!(linked_image.children[0].role, LayoutSemanticRole::Image);
    assert_eq!(linked_image.children[0].alt.as_deref(), Some("Linked"));
}

#[test]
fn applies_nested_visual_offsets_and_clips_to_semantic_bounds() {
    let mut outer = block(
        "p",
        10.0,
        20.0,
        vec![
            RuntimeChild::Block(Box::new(block(
                "div",
                80.0,
                30.0,
                vec![line_at(0.0, 0.0, vec![text_at("clipped", 10.0, 5.0, 40.0)])],
            ))),
            RuntimeChild::Image(RuntimeImage {
                x: 90.0,
                y: 60.0,
                width: 30.0,
                height: 30.0,
                src: "clipped.png".to_owned(),
                alt: Some("clipped image".to_owned()),
                href: None,
            }),
            RuntimeChild::Block(Box::new(block(
                "p",
                200.0,
                0.0,
                vec![line(vec![text("hidden", None)])],
            ))),
        ],
    );
    outer.width = 100.0;
    outer.height = 80.0;
    outer.paint = Some(json!({
        "visualOffset": { "dx": 5.0, "dy": -2.0 },
        "clipToBounds": true,
    }));
    let page = RuntimePage::new(0, 400.0, 600.0, None, vec![outer]);

    let nodes = build_page_semantic_tree(&page);

    assert_eq!(nodes.len(), 1);
    let outer = &nodes[0];
    assert_eq!((outer.bounds.x, outer.bounds.y), (15.0, 18.0));
    assert_eq!((outer.bounds.width, outer.bounds.height), (100.0, 80.0));
    assert_eq!(outer.children.len(), 2, "fully clipped subtree is omitted");

    let nested = &outer.children[0];
    assert_eq!((nested.bounds.x, nested.bounds.y), (95.0, 48.0));
    assert_eq!((nested.bounds.width, nested.bounds.height), (20.0, 36.0));
    let run = &nested.children[0];
    assert_eq!((run.bounds.x, run.bounds.y), (105.0, 53.0));
    assert_eq!((run.bounds.width, run.bounds.height), (10.0, 12.0));

    let image = &outer.children[1];
    assert_eq!((image.bounds.x, image.bounds.y), (105.0, 78.0));
    assert_eq!((image.bounds.width, image.bounds.height), (10.0, 20.0));
}

#[test]
fn exposes_rotated_semantics_as_page_content_aabbs() {
    let mut rotated = block(
        "p",
        10.0,
        20.0,
        vec![line(vec![text_at("rotated", 10.0, 5.0, 40.0)])],
    );
    rotated.width = 100.0;
    rotated.height = 40.0;
    rotated.paint = Some(json!({
        "transform": [{ "kind": "rotate", "rad": std::f64::consts::FRAC_PI_2 }],
    }));
    let page = RuntimePage::new(0, 400.0, 600.0, None, vec![rotated]);

    let nodes = build_page_semantic_tree(&page);
    let block = &nodes[0];
    let run = &block.children[0];

    assert_rect(&block.bounds, 40.0, -10.0, 40.0, 100.0);
    assert_rect(&run.bounds, 63.0, 0.0, 12.0, 40.0);
}

#[test]
fn skips_ruby_paint_annotations_without_losing_base_text() {
    let page = RuntimePage::new(
        0,
        400.0,
        600.0,
        None,
        vec![block(
            "p",
            0.0,
            0.0,
            vec![line(vec![
                text("base", None),
                LineRun::Ruby(RubyRunBox {
                    text: "annotation".to_owned(),
                    x: 0.0,
                    y: -8.0,
                    width: 24.0,
                    height: 8.0,
                    paint: RunPaint::default(),
                }),
            ])],
        )],
    );

    let nodes = build_page_semantic_tree(&page);

    assert_eq!(nodes[0].text.as_deref(), Some("base"));
    assert_eq!(nodes[0].children.len(), 1);
    assert_eq!(nodes[0].children[0].text.as_deref(), Some("base"));
}

#[test]
fn exposes_only_non_empty_inline_atom_semantics() {
    let page = RuntimePage::new(
        0,
        400.0,
        600.0,
        None,
        vec![block(
            "p",
            0.0,
            0.0,
            vec![line(vec![
                atom(Some("standalone.png"), Some("standalone"), None),
                atom(Some("linked.png"), Some("linked"), Some("#target")),
                atom(None, None, Some("#empty-atom-target")),
                atom(Some(""), Some("not an image"), None),
                atom(None, None, Some("  ")),
            ])],
        )],
    );

    let nodes = build_page_semantic_tree(&page);
    let children = &nodes[0].children;

    assert_eq!(children.len(), 3);
    assert_eq!(children[0].role, LayoutSemanticRole::Image);
    assert_eq!(children[0].alt.as_deref(), Some("standalone"));
    assert_eq!(children[1].role, LayoutSemanticRole::Link);
    assert_eq!(children[1].href.as_deref(), Some("#target"));
    assert_eq!(children[1].children[0].role, LayoutSemanticRole::Image);
    assert_eq!(children[1].children[0].alt.as_deref(), Some("linked"));
    assert_eq!(children[2].role, LayoutSemanticRole::Link);
    assert_eq!(children[2].href.as_deref(), Some("#empty-atom-target"));
    assert!(children[2].children.is_empty());
}

#[test]
fn keeps_empty_alt_distinct_but_does_not_create_empty_links() {
    let page = RuntimePage::new(
        0,
        400.0,
        600.0,
        None,
        vec![block(
            "p",
            0.0,
            0.0,
            vec![
                line(vec![text("current", Some(""))]),
                RuntimeChild::Image(RuntimeImage {
                    x: 0.0,
                    y: 24.0,
                    width: 20.0,
                    height: 20.0,
                    src: "decorative.png".to_owned(),
                    alt: Some(String::new()),
                    href: Some(String::new()),
                }),
            ],
        )],
    );

    let nodes = build_page_semantic_tree(&page);
    let children = &nodes[0].children;

    assert_eq!(children[0].role, LayoutSemanticRole::Generic);
    assert_eq!(children[0].href, None);
    assert_eq!(children[1].role, LayoutSemanticRole::Image);
    assert_eq!(children[1].alt.as_deref(), Some(""));
}
