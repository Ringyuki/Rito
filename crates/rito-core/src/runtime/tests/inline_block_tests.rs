//! An inline block stands on its line by its margin box: its margins,
//! borders and padding surround its content, push its last line's
//! baseline down and grow the line it rides, as Chromium 156 lays out a
//! translation wrapped in `display: inline-block; margin: 8px 0` (the
//! pinned serif at 18px, `line-height: 120%`, 372px wide; the offsets are
//! from the first line's baseline, read off the DOM line rects).

use rito_block::BlockFormattingContext;
use rito_fragment::{CancelFlag, Fragment, LineText};
use rito_inline::ParleyInlineContext;

use super::pinned_font_policy_fixtures::{bundled_font, content_epub, layout};
use crate::fragment_pagination::layout_chapter_strip;
use crate::runtime::RuntimeDocument;

const BODY: &str = "<p>Harry and Ron met.<span class=\"w\"><br/><span>隔天早餐前，哈利和榮恩在公共休息室見到了妙麗。哈利希望自己的理論能得到一些支持，他立刻告訴妙麗。</span></span></p><p>Next paragraph.</p>";

/// Each line's baseline down the chapter.
fn baselines(stylesheet: &str) -> Vec<f64> {
    let bytes = content_epub(
        "zh-CN",
        BODY,
        &format!("p {{ margin: 0; font-size: 18px; line-height: 120%; }} {stylesheet}"),
        None,
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
        LineText::Omitted,
        &CancelFlag::new(),
    )
    .expect("strip lays out");
    fn walk(fragment: &Fragment, top: f64, out: &mut Vec<f64>) {
        match fragment {
            Fragment::Box(block) => {
                for child in &block.children {
                    walk(child, top + block.rect.y, out);
                }
            }
            Fragment::Line(line) => out.push(top + line.rect.y + line.baseline),
            Fragment::Text(_) | Fragment::Image(_) => {}
        }
    }
    let mut out = Vec::new();
    walk(&strip, 0.0, &mut out);
    out
}

#[test]
fn an_inline_block_rides_its_line_by_its_margin_box() {
    for (stylesheet, block_line, next_paragraph) in [
        (
            ".w { display: inline-block; margin: 8px 0; }",
            94.375,
            123.96875,
        ),
        (
            ".w { display: inline-block; margin: 8px 0; padding: 3px 0; }",
            97.375,
            129.96875,
        ),
    ] {
        let lines = baselines(stylesheet);
        let first = lines[0];
        assert_eq!(
            [lines[1] - first, lines[2] - first],
            [block_line, next_paragraph],
            "{stylesheet}: {lines:?}"
        );
    }
}

/// The lines each page holds, nested boxes included.
fn page_line_counts(body: &str, stylesheet: &str, height: f64) -> Vec<usize> {
    use crate::fragment_pagination::layout_chapter_page;
    let bytes = content_epub("en", body, stylesheet, None);
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
    fn count(fragment: &Fragment) -> usize {
        match fragment {
            Fragment::Box(block) => block.children.iter().map(count).sum(),
            Fragment::Line(_) => 1,
            Fragment::Text(_) | Fragment::Image(_) => 0,
        }
    }
    let cancel = CancelFlag::new();
    let mut counts = Vec::new();
    let mut token = None;
    loop {
        let (page, next) =
            layout_chapter_page(&engine, &built.tree, 372.0, height, token.as_ref(), &cancel)
                .expect("page lays out");
        counts.push(count(&page));
        match next {
            Some(next) if counts.len() < 6 => token = Some(next),
            _ => break,
        }
    }
    counts
}

/// An inline table is an atomic inline, which a line never breaks
/// inside: when it does not fit what is left of a page it moves to the
/// next one whole, where a block table breaks between its rows (as
/// Chromium fragments a book's `table { display: inline-table }` results
/// grid, leaving the page bare under the heading above it).
#[test]
fn an_inline_table_moves_to_the_next_page_whole() {
    let body = "<p>a</p><p>b</p><p>c</p><table><tr><td>1</td></tr><tr><td>2</td></tr><tr><td>3</td></tr><tr><td>4</td></tr><tr><td>5</td></tr><tr><td>6</td></tr></table>";
    let base = "p { margin: 0; line-height: 20px; } table { border-spacing: 0; } td { padding: 0; line-height: 20px; }";
    assert_eq!(
        page_line_counts(body, base, 100.0),
        vec![5, 4],
        "a block table breaks between rows"
    );
    assert_eq!(
        page_line_counts(
            body,
            &format!("{base} table {{ display: inline-table; }}"),
            100.0
        ),
        vec![3, 6],
        "an inline table moves whole"
    );
}
