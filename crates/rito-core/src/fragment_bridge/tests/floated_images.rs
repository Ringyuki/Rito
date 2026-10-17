//! Floated images: one that opens a block's inline content is a float box
//! exactly its own size, and lines and later floats wrap beside it; one
//! after content on its line stays an inline image, with a degradation.

use super::*;
use rito_fragment::FragmentRect;

const CSS: &str = "body { margin: 0; padding: 0; font-family: Tinos; font-size: 16px; }
p { margin: 0; line-height: 20px; }
.av { width: 40px; height: 40px; vertical-align: middle; }
.fl { float: left; } .fr { float: right; } .cb { clear: both; }
.bubble { width: 100px; margin: 0 8px; line-height: 20px; }";

/// Lays the chapter out 300px wide in continuous space and returns every
/// image's and every text run's absolute rect, in paint order, with the
/// chapter's degradations.
fn layout(body: &str) -> (Vec<(&'static str, FragmentRect)>, Vec<String>) {
    let chapter = resolved_chapter_with(
        &format!(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>{body}</body></html>"#
        ),
        CSS,
    );
    let images = BTreeMap::from([
        ("a.png".to_owned(), (80, 80)),
        ("b.png".to_owned(), (80, 80)),
    ]);
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &images,
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
    fn walk(fragment: &Fragment, x: f64, y: f64, out: &mut Vec<(&'static str, FragmentRect)>) {
        let at = |rect: FragmentRect| FragmentRect {
            x: x + rect.x,
            y: y + rect.y,
            ..rect
        };
        match fragment {
            Fragment::Box(node) => {
                for child in &node.children {
                    walk(child, x + node.rect.x, y + node.rect.y, out);
                }
            }
            Fragment::Line(line) => {
                for child in &line.children {
                    walk(child, x + line.rect.x, y + line.rect.y, out);
                }
            }
            Fragment::Image(image) => out.push(("image", at(image.rect))),
            Fragment::Text(text) => out.push(("text", at(text.rect))),
        }
    }
    let mut out = Vec::new();
    walk(&outcome.fragments.root, 0.0, 0.0, &mut out);
    (out, built.degradations)
}

fn rects(fragments: &[(&'static str, FragmentRect)], kind: &str) -> Vec<FragmentRect> {
    fragments
        .iter()
        .filter(|(what, _)| *what == kind)
        .map(|(_, rect)| *rect)
        .collect()
}

#[test]
fn floated_avatars_sit_beside_their_floated_bubbles() {
    // The chat-bubble idiom: an avatar floated inside its own <div>, the
    // bubble floated after it, a clearing paragraph between turns.
    let (fragments, degradations) = layout(
        r#"<div><img class="av fl" src="a.png" alt=""/></div>
<div class="fl bubble">Hi</div>
<p class="cb"></p>
<div><img class="av fr" src="b.png" alt=""/></div>
<div class="fr bubble">Yo</div>"#,
    );
    let images = rects(&fragments, "image");
    let texts = rects(&fragments, "text");
    assert_eq!(images.len(), 2);
    assert_eq!(texts.len(), 2);
    // Left avatar at the content's left edge, its bubble past its 8px
    // margin beside it.
    assert_eq!((images[0].x, images[0].y), (0.0, 0.0));
    assert_eq!((images[0].width, images[0].height), (40.0, 40.0));
    assert_eq!((texts[0].x, texts[0].y), (48.0, 0.0));
    // The clearing paragraph drops below the taller of the two floats,
    // the 40px avatar; the right avatar takes the right edge and its
    // bubble sits left of it past the bubble's 8px right margin.
    assert_eq!((images[1].x, images[1].y), (260.0, 40.0));
    assert_eq!((texts[1].x, texts[1].y), (152.0, 40.0));
    assert!(
        !degradations
            .iter()
            .any(|reason| reason.contains("floated image")),
        "{degradations:?}"
    );
}

#[test]
fn a_floated_image_box_is_exactly_the_image() {
    // No line box surrounds a float, so no strut descent hangs below the
    // image: the cleared paragraph starts at the image's bottom edge.
    let (fragments, _) =
        layout(r#"<div><img class="av fl" src="a.png" alt=""/></div><p class="cb">after</p>"#);
    let texts = rects(&fragments, "text");
    assert_eq!(texts[0].y, 40.0);
}

#[test]
fn lines_after_a_floated_image_opening_a_paragraph_wrap_beside_it() {
    let (fragments, _) = layout(
        r#"<p><img class="av fl" src="a.png" alt=""/>Lines beside the floated image start past it while the image reaches down beside them, and the line below its bottom edge starts at the left edge again.</p>"#,
    );
    let images = rects(&fragments, "image");
    let texts = rects(&fragments, "text");
    assert_eq!((images[0].x, images[0].y), (0.0, 0.0));
    let line_x = |y: f64| {
        texts
            .iter()
            .find(|rect| rect.y == y)
            .map(|rect| rect.x)
            .unwrap_or_else(|| panic!("a line at {y}: {texts:?}"))
    };
    // 20px lines: the first two lie beside the 40px image, the third
    // below it.
    assert_eq!(line_x(0.0), 40.0);
    assert_eq!(line_x(20.0), 40.0);
    assert_eq!(line_x(40.0), 0.0);
}

#[test]
fn a_floated_image_after_text_stays_inline_and_says_so() {
    let (fragments, degradations) =
        layout(r#"<p>before <img class="av fl" src="a.png" alt=""/></p>"#);
    let images = rects(&fragments, "image");
    assert!(images[0].x > 0.0, "the image follows the text on its line");
    assert!(
        degradations
            .iter()
            .any(|reason| reason.contains("floated image laid out in-flow")),
        "{degradations:?}"
    );
}
