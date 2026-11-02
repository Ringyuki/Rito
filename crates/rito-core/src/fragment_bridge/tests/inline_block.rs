//! Inline blocks as Blink lays them out: an atomic inline whatever the
//! element, sized by its own `width` and `height`, standing on the line
//! when empty, and holding block-level boxes as a block container.

use super::*;

fn lay_out(xhtml: &str, css: &str, space: &ConstraintSpace) -> Fragment {
    let chapter = resolved_chapter_with(xhtml, css);
    let built = build_chapter_formatting_tree(
        &chapter.nodes,
        chapter.body_index,
        &chapter.layout,
        &chapter.inline,
        &no_images(),
    )
    .expect("tree builds");
    let engine = BlockFormattingContext::new(
        ParleyInlineContext::new(vec![tinos_bytes()]).expect("fonts register"),
    );
    engine
        .layout(
            &built.tree,
            built.tree.root(),
            space,
            None,
            &CancelFlag::new(),
        )
        .expect("lays out")
        .fragments
        .root
}

/// Every line box of the tree, with its block offset in the root's
/// coordinates.
fn lines(fragment: &Fragment) -> Vec<(f64, &rito_fragment::LineFragment)> {
    fn walk<'a>(
        fragment: &'a Fragment,
        offset: f64,
        out: &mut Vec<(f64, &'a rito_fragment::LineFragment)>,
    ) {
        match fragment {
            Fragment::Box(node) => {
                for child in &node.children {
                    walk(child, offset + node.rect.y, out);
                }
            }
            Fragment::Line(line) => out.push((offset + line.rect.y, line)),
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(fragment, 0.0, &mut out);
    out
}

fn atoms(line: &rito_fragment::LineFragment) -> Vec<&rito_fragment::BoxFragment> {
    line.children
        .iter()
        .filter_map(|child| match child {
            Fragment::Box(atom) => Some(atom),
            _ => None,
        })
        .collect()
}

/// A `<div>` styled `display: inline-block` rides its parent's line between
/// the text around it, its block children laid out inside it.
#[test]
fn an_inline_block_div_rides_its_parents_line() {
    let root = lay_out(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div>a<div class="ib"><div>x</div><div>y</div></div>b</div>
</body></html>"#,
        "body { margin: 0; font-size: 10px; line-height: 10px; } .ib { display: inline-block; }\n",
        &ConstraintSpace::continuous(640.0),
    );
    let lines = lines(&root);
    let host = lines
        .iter()
        .find(|(_, line)| !atoms(line).is_empty())
        .expect("a line holds the inline block");
    let atom = atoms(host.1)[0];
    let inner: Vec<_> = atom
        .children
        .iter()
        .filter(|child| matches!(child, Fragment::Box(_)))
        .collect();
    assert_eq!(inner.len(), 2, "both block children inside the atom");
    assert_eq!(atom.rect.height, 20.0, "two 10px lines tall");
    let texts = host
        .1
        .children
        .iter()
        .filter(|child| matches!(child, Fragment::Text(_)))
        .count();
    assert!(texts >= 2, "the text on both sides shares its line");
}

/// An empty inline-block stands on the line at its specified size,
/// pushing the text after it along (Blink keeps it as an atomic inline).
#[test]
fn an_empty_inline_block_takes_its_specified_size() {
    let root = lay_out(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div><span class="ib"></span>b</div>
</body></html>"#,
        "body { margin: 0; font-size: 10px; line-height: 10px; } .ib { display: inline-block; width: 30px; height: 20px; }\n",
        &ConstraintSpace::continuous(640.0),
    );
    let lines = lines(&root);
    assert_eq!(lines.len(), 1);
    let line = lines[0].1;
    let atom = atoms(line)[0];
    assert_eq!((atom.rect.width, atom.rect.height), (30.0, 20.0));
    let text_x = line
        .children
        .iter()
        .find_map(|child| match child {
            Fragment::Text(text) => Some(text.rect.x),
            _ => None,
        })
        .expect("the text after it");
    assert_eq!(text_x, 30.0);
}

/// A horizontal inline-block on a vertical line resolves `width: 100%`
/// against the initial containing block when the line's block size is
/// indefinite, as Blink's orthogonal fallback does — the page, here — so
/// calibre's empty plate spacer makes its line as wide as the page.
#[test]
fn an_orthogonal_spacer_spans_the_page_across_its_line() {
    let root = lay_out(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body>
<div class="v"><span class="spacer"></span>x</div>
</body></html>"#,
        "html, body { writing-mode: vertical-rl; } body { margin: 0; font-size: 10px; line-height: 10px; } .spacer { writing-mode: horizontal-tb; display: inline-block; width: 100%; }\n",
        &ConstraintSpace::fragmented(850.0, 640.0),
    );
    let lines = lines(&root);
    assert_eq!(lines.len(), 1);
    assert_eq!(
        lines[0].1.rect.height, 640.0,
        "the line stands as wide as the page"
    );
}
