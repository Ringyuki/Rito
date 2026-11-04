//! Which stylesheets a chapter of a publication opened from its archive
//! lays out under: the ones it links (and embeds), as a browser applies
//! them — a chapter without a `<link>` takes no publication stylesheet,
//! however the package lists them (a book's unlinked note page keeps its
//! UA paragraphs where its `Style.css` indents every other chapter's).

use rito_block::BlockFormattingContext;
use rito_fragment::{CancelFlag, Fragment, LineText};
use rito_inline::ParleyInlineContext;

use super::pinned_font_policy_fixtures::{bundled_font, content_epub_linking, layout};
use crate::fragment_pagination::layout_chapter_strip;
use crate::runtime::RuntimeDocument;

/// The first line's inline offset within its paragraph.
fn first_line_x(linked: bool) -> f64 {
    let bytes = content_epub_linking(
        "zh-CN",
        "<p>文字</p>",
        "p { margin: 0; text-indent: 2em; }",
        None,
        linked,
    );
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document opens");
    let revision_id = document
        .create_revision(&layout())
        .expect("revision")
        .revision_id;
    let inline = ParleyInlineContext::new(vec![bundled_font("SourceHanSerifCN-Regular.otf")])
        .expect("font registers");
    let engine = BlockFormattingContext::new(inline);
    let built = document
        .chapter_formatting_tree(&revision_id, "chapter")
        .expect("tree builds");
    let strip = layout_chapter_strip(
        &engine,
        &built.tree,
        372.0,
        592.0,
        LineText::All,
        &CancelFlag::new(),
    )
    .expect("strip lays out");
    fn first_line(fragment: &Fragment) -> Option<f64> {
        match fragment {
            Fragment::Box(block) => block.children.iter().find_map(first_line),
            Fragment::Line(line) => line
                .children
                .first()
                .map(|child| line.rect.x + child.rect().x),
            Fragment::Text(_) | Fragment::Image(_) => None,
        }
    }
    first_line(&strip).expect("a line")
}

#[test]
fn a_chapter_takes_only_the_stylesheets_it_links() {
    assert_eq!(first_line_x(true), 32.0, "the linked sheet indents 2em");
    assert_eq!(first_line_x(false), 0.0, "an unlinked sheet does not apply");
}
