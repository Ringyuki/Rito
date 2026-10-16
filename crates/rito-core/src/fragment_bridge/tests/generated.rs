//! Generated boxes: an element's `::before` and `::after` laid out as CSS
//! places them — text inside the element's lines, a block of its own, or
//! an absolutely positioned box against its containing block.

use super::*;
use rito_fragment::FragmentRect;

/// Lays the chapter out 300px wide in continuous space; returns every box
/// fragment's absolute rect with its source node, every text run's
/// absolute rect, and the degradations.
fn layout(body: &str, css: &str) -> (Vec<(u32, FragmentRect)>, Vec<FragmentRect>, Vec<String>) {
    let chapter = resolved_chapter_with(
        &format!(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>{body}</body></html>"#
        ),
        css,
    );
    let built = build_chapter_formatting_tree_with_generated(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &chapter.generated,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    let outcome = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(300.0),
            None,
            &CancelFlag::new(),
        )
        .expect("lays out");
    fn walk(
        fragment: &Fragment,
        x: f64,
        y: f64,
        boxes: &mut Vec<(u32, FragmentRect)>,
        texts: &mut Vec<FragmentRect>,
    ) {
        match fragment {
            Fragment::Box(node) => {
                let at = FragmentRect {
                    x: x + node.rect.x,
                    y: y + node.rect.y,
                    ..node.rect
                };
                boxes.push((node.source.0, at));
                for child in &node.children {
                    walk(child, at.x, at.y, boxes, texts);
                }
            }
            Fragment::Line(line) => {
                for child in &line.children {
                    walk(child, x + line.rect.x, y + line.rect.y, boxes, texts);
                }
            }
            Fragment::Text(text) => texts.push(FragmentRect {
                x: x + text.rect.x,
                y: y + text.rect.y,
                ..text.rect
            }),
            Fragment::Image(_) => {}
        }
    }
    let (mut boxes, mut texts) = (Vec::new(), Vec::new());
    walk(&outcome.fragments.root, 0.0, 0.0, &mut boxes, &mut texts);
    (boxes, texts, built.degradations)
}

const BASE: &str = "body { margin: 0; padding: 0; font-family: Tinos; font-size: 16px; }
p { margin: 0; line-height: 20px; }";

#[test]
fn an_absolutely_positioned_tail_hangs_outside_its_bubble() {
    // The speech-bubble tail: an empty `::before` of a relatively
    // positioned float, pinned past its left edge (`right: 100%`) at its
    // top, drawn by a 12px right border over a 16px transparent bottom.
    let css = format!(
        "{BASE} .bubble {{ float: left; position: relative; width: 100px; margin-left: 40px;
           line-height: 20px; background-color: #6EB478; }}
         .bubble:before {{ content: \"\"; position: absolute; right: 100%; top: 0;
           border-top: 0 solid transparent; border-right: 12px solid #6EB478;
           border-bottom: 16px solid transparent; }}"
    );
    let (boxes, texts, degradations) = layout(r#"<div class="bubble">Hi</div>"#, &css);
    // The bubble at its 40px margin, the text in it untouched by the tail.
    assert_eq!((texts[0].x, texts[0].y), (40.0, 0.0));
    let tail = boxes
        .iter()
        .map(|(_, rect)| *rect)
        .find(|rect| (rect.width, rect.height) == (12.0, 16.0))
        .unwrap_or_else(|| panic!("a 12x16 tail box: {boxes:?}"));
    assert_eq!((tail.x, tail.y), (28.0, 0.0));
    assert!(
        !degradations
            .iter()
            .any(|reason| reason.contains("absolute")),
        "{degradations:?}"
    );
}

#[test]
fn inline_generated_text_opens_and_closes_the_lines() {
    let css = format!("{BASE} .note:before {{ content: \"[\" attr(title) \"] \"; }} .note:after {{ content: \"!\"; }}");
    let (_, texts, _) = layout(r#"<p class="note" title="1">text</p>"#, &css);
    // Three runs (the generated text has its own style) on one line, in
    // order: "[1] " at the left edge, then "text", then "!".
    assert_eq!(texts.len(), 3, "{texts:?}");
    assert!(texts.iter().all(|run| run.y == texts[0].y), "{texts:?}");
    assert_eq!(texts[0].x, 0.0);
    assert!(
        texts[0].x < texts[1].x && texts[1].x < texts[2].x,
        "{texts:?}"
    );
}

#[test]
fn a_clearing_block_after_closes_its_floats() {
    // The clearfix idiom: an empty block `::after` that clears both sides
    // makes its container reach below the floats inside it.
    let css = format!(
        "{BASE} .row:after {{ content: \"\"; display: block; clear: both; }}
         .float {{ float: left; width: 50px; height: 40px; }}"
    );
    let (_, texts, _) = layout(
        r#"<div class="row"><div class="float"></div></div><p>after</p>"#,
        &css,
    );
    assert_eq!(texts[0].y, 40.0);
}

#[test]
fn an_absolutely_positioned_block_leaves_the_flow() {
    let css = format!(
        "{BASE} .frame {{ position: relative; }}
         .corner {{ position: absolute; right: 0; bottom: 0; width: 20px; height: 10px; }}"
    );
    let (_, texts, _) = layout(
        r#"<div class="frame"><p>one</p><div class="corner"></div><p>two</p></div>"#,
        &css,
    );
    // The corner takes no room between the paragraphs.
    assert_eq!((texts[0].y, texts[1].y), (0.0, 20.0));
}
