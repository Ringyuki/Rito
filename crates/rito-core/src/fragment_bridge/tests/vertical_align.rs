//! `vertical-align: middle` on atomic inlines: the box's middle half its
//! parent's x-height above the parent's baseline, placed as Chromium
//! places it (offsets measured in pinned Chromium on 10px Tinos lines
//! 16px tall).

use super::*;

/// The first atom's top and bottom against its line's baseline (down
/// positive), and the line's height.
fn atom_against_baseline(body: &str, writing_mode: &str) -> (f64, f64, f64) {
    let chapter = resolved_chapter_with(
        &format!(
            r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>t</title></head><body><div>{body}</div></body></html>"#
        ),
        &format!(
            "body {{ margin: 0; font-family: Tinos; font-size: 10px; line-height: 16px; writing-mode: {writing_mode}; }} .m {{ vertical-align: middle; }}\n"
        ),
    );
    let images = BTreeMap::from([("px.png".to_owned(), (2, 2))]);
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
    let root = engine
        .layout(
            &built.tree,
            built.tree.root(),
            &ConstraintSpace::continuous(640.0),
            None,
            &CancelFlag::new(),
        )
        .expect("lays out")
        .fragments
        .root;
    fn find(fragment: &Fragment) -> Option<(f64, f64, f64)> {
        match fragment {
            Fragment::Box(node) => node.children.iter().find_map(find),
            Fragment::Line(line) => line.children.iter().find_map(|child| {
                let rect = match child {
                    Fragment::Image(image) => image.rect,
                    Fragment::Box(atom) => atom.rect,
                    _ => return None,
                };
                Some((
                    rect.y - line.baseline,
                    rect.y + rect.height - line.baseline,
                    line.rect.height,
                ))
            }),
            _ => None,
        }
    }
    find(&root).expect("an atom on a line")
}

#[test]
fn a_middle_image_centres_half_the_x_height_above_the_baseline() {
    assert_eq!(
        atom_against_baseline(
            r#"x<img class="m" src="px.png" style="width: 20px; height: 30px" alt=""/>x"#,
            "horizontal-tb"
        ),
        (-17.296875, 12.703125, 30.0)
    );
}

#[test]
fn a_middle_inline_block_centres_by_its_last_baseline() {
    assert_eq!(
        atom_against_baseline(
            r#"x<span class="m" style="display: inline-block; width: 20px; height: 30px"></span>x"#,
            "horizontal-tb"
        ),
        (-17.296875, 12.703125, 30.0)
    );
    let (top, bottom, _) = atom_against_baseline(
        r#"x<span class="m" style="display: inline-block">Ab<br/>Cd</span>x"#,
        "horizontal-tb",
    );
    assert_eq!((top, bottom), (-18.296875, 13.703125));
}

/// The x-height is the parent box's, not the atom's own font.
#[test]
fn middle_takes_the_parent_box_x_height() {
    let (top, bottom, _) = atom_against_baseline(
        r#"x<span class="m" style="display: inline-block; width: 20px; height: 30px; font-size: 30px"></span>x"#,
        "horizontal-tb",
    );
    assert_eq!((top, bottom), (-17.296875, 12.703125));
    let (top, bottom, _) = atom_against_baseline(
        r#"x<span style="font-size: 20px">y<img class="m" src="px.png" style="width: 20px; height: 30px" alt=""/></span>"#,
        "horizontal-tb",
    );
    assert_eq!((top, bottom), (-19.59375, 10.40625));
}
