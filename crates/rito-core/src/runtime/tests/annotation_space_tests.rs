//! A paragraph's first-line ruby reaches into the space above the line
//! before the line grows (Blink's block-start annotation space): the
//! collapsed margin above it and what the paragraph before it leaves under
//! its last line, unless a top border or the paragraph's own formatting
//! context closes it off. A line that opens a page has none of it.

use rito_block::BlockFormattingContext;
use rito_fragment::{BreakToken, CancelFlag, Fragment, LineText};
use rito_inline::ParleyInlineContext;

use super::pinned_font_policy_fixtures::{bundled_font, content_epub, layout};
use crate::fragment_pagination::{layout_chapter_page, layout_chapter_strip};
use crate::runtime::RuntimeDocument;

const RUBY: &str = "<ruby>人族<rt>Emnetwiht</rt></ruby>一同灭亡了。";
const PLAIN: &str = "人族一同灭亡了。";
const PREVIOUS: &str = "这是前一段的文字。";
const BASE: &str = "p { font-size: 18px; line-height: 120%; text-indent: 0; }";
const WIDTH: f64 = 372.0;

struct Book {
    document: RuntimeDocument,
    revision_id: String,
    engine: BlockFormattingContext<ParleyInlineContext>,
}

fn book(body: &str, stylesheet: &str) -> Book {
    let bytes = content_epub("zh-CN", body, &format!("{BASE}\n{stylesheet}"), None);
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document opens");
    let revision_id = document
        .create_revision(&layout())
        .expect("revision")
        .revision_id;
    let inline = ParleyInlineContext::new(vec![bundled_font("SourceHanSerifCN-Regular.otf")])
        .expect("font registers");
    Book {
        document,
        revision_id,
        engine: BlockFormattingContext::new(inline),
    }
}

/// Every line's baseline, ruby growth and ruby overflow, down the page.
fn lines(fragment: &Fragment) -> Vec<(f64, f64, f64)> {
    fn walk(fragment: &Fragment, top: f64, out: &mut Vec<(f64, f64, f64)>) {
        match fragment {
            Fragment::Box(block) => {
                for child in &block.children {
                    walk(child, top + block.rect.y, out);
                }
            }
            Fragment::Line(line) => out.push((
                top + line.rect.y + line.baseline,
                line.ruby_growth,
                line.ruby_overflow,
            )),
            Fragment::Text(_) | Fragment::Image(_) => {}
        }
    }
    let mut out = Vec::new();
    walk(fragment, 0.0, &mut out);
    out
}

fn strip_lines(body: &str, stylesheet: &str) -> Vec<(f64, f64, f64)> {
    let book = book(body, stylesheet);
    let built = book
        .document
        .chapter_formatting_tree(&book.revision_id, "chapter")
        .expect("tree builds");
    let strip = layout_chapter_strip(
        &book.engine,
        &built.tree,
        WIDTH,
        592.0,
        LineText::Omitted,
        &CancelFlag::new(),
    )
    .expect("strip lays out");
    lines(&strip)
}

/// How far the ruby pushes line `index` down: its baseline with the
/// annotation against the same body without it.
fn push(ruby_body: &str, stylesheet: &str, index: usize) -> f64 {
    let plain_body = ruby_body.replace(RUBY, PLAIN);
    let with = strip_lines(ruby_body, stylesheet)[index].0;
    let without = strip_lines(&plain_body, stylesheet)[index].0;
    with - without
}

/// The overflow of a first-line ruby with no space above it.
fn overflow() -> f64 {
    let pushed = push(&format!("<p>{RUBY}</p>"), "p { margin: 0; }", 0);
    assert!(pushed > 5.0, "the annotation overflows the line: {pushed}");
    pushed
}

#[test]
fn a_first_line_ruby_reaches_into_the_collapsed_margin_above() {
    // 0.25em at 18px: the margin lends 4.5px.
    let pushed = push(&format!("<p>{RUBY}</p>"), "p { margin: 0.25em 0; }", 0);
    assert!(
        (pushed - (overflow() - 4.5)).abs() < 1e-6,
        "{pushed} vs {}",
        overflow() - 4.5
    );
}

#[test]
fn a_top_border_keeps_the_ruby_out_of_the_margin() {
    let pushed = push(
        &format!("<p class=\"t\">{RUBY}</p>"),
        "p { margin: 0.5em 0; } p.t { border-top: 1px solid black; }",
        0,
    );
    assert!(
        (pushed - overflow()).abs() < 1e-6,
        "{pushed} vs {}",
        overflow()
    );
}

#[test]
fn a_paragraph_of_its_own_formatting_context_keeps_the_ruby_inside() {
    let pushed = push(
        &format!("<p class=\"t\">{RUBY}</p>"),
        "p { margin: 0.5em 0; } p.t { display: flow-root; }",
        0,
    );
    assert!(
        (pushed - overflow()).abs() < 1e-6,
        "{pushed} vs {}",
        overflow()
    );
}

#[test]
fn a_first_line_ruby_reuses_the_leading_under_the_paragraph_before() {
    // With no margin between, the previous paragraph's last line lends
    // what a previous line of the same paragraph would.
    let across = push(
        &format!("<p>{PREVIOUS}</p><p>{RUBY}</p>"),
        "p { margin: 0; }",
        1,
    );
    let within = push(
        &format!("<p>{PREVIOUS}<br/>{RUBY}</p>"),
        "p { margin: 0; }",
        1,
    );
    assert!(
        within < overflow(),
        "the previous line lends space: {within}"
    );
    assert!((across - within).abs() < 1e-6, "{across} vs {within}");
}

/// The lines of each page of the chapter laid out `height` tall.
fn page_lines(body: &str, stylesheet: &str, height: f64) -> Vec<Vec<(f64, f64, f64)>> {
    let book = book(body, stylesheet);
    let built = book
        .document
        .chapter_formatting_tree(&book.revision_id, "chapter")
        .expect("tree builds");
    let cancel = CancelFlag::new();
    let mut pages = Vec::new();
    let mut token: Option<BreakToken> = None;
    loop {
        let (page, next) = layout_chapter_page(
            &book.engine,
            &built.tree,
            WIDTH,
            height,
            token.as_ref(),
            &cancel,
        )
        .expect("page lays out");
        pages.push(lines(&page));
        match next {
            Some(next) if pages.len() < 8 => token = Some(next),
            _ => break,
        }
    }
    pages
}

#[test]
fn a_ruby_line_opening_a_resumed_page_takes_its_whole_overflow() {
    // Two 21.6px lines fill the first page; the ruby line opens the next,
    // where the line before it lends nothing.
    let body = format!("<p>{PREVIOUS}<br/>{PREVIOUS}<br/>{RUBY}</p>");
    let pages = page_lines(&body, "p { margin: 0; }", 50.0);
    let (_, growth, overflow) = pages[1][0];
    assert!(overflow > 5.0, "the ruby line opens page 2: {pages:?}");
    assert_eq!(growth, overflow, "{pages:?}");
}

#[test]
fn a_paragraph_opening_a_page_after_a_break_loses_the_margin_above() {
    // The margin meeting the break is truncated, so it lends nothing.
    let body = format!("<p>{PREVIOUS}</p><p>{RUBY}</p>");
    let pages = page_lines(&body, "p { margin: 0.5em 0; }", 40.0);
    let (_, growth, overflow) = pages[1][0];
    assert!(overflow > 5.0, "the ruby paragraph opens page 2: {pages:?}");
    assert_eq!(growth, overflow, "{pages:?}");
}

#[test]
fn an_empty_line_above_lends_only_its_half_leading() {
    // (21.6 - 18) / 2 on the LayoutUnit grid, as Chromium reuses it after
    // `<p><br/></p>`.
    let half_leading = 1.796875;
    let across = push(&format!("<p><br/></p><p>{RUBY}</p>"), "p { margin: 0; }", 1);
    assert!(
        (across - (overflow() - half_leading)).abs() < 1e-6,
        "{across} vs {}",
        overflow() - half_leading
    );
    let within = push(
        &format!("<p>{PREVIOUS}<br/><br/>{RUBY}</p>"),
        "p { margin: 0; }",
        2,
    );
    assert!((within - across).abs() < 1e-6, "{within} vs {across}");
}

#[test]
fn a_ruby_paragraph_lent_space_above_resumes_where_its_first_page_stopped() {
    // The first page lays the paragraph out against the paragraph before
    // it, the next resumes it without; both must slice one geometry.
    let long = PREVIOUS.repeat(24);
    let body = format!("<p>{PREVIOUS}</p><p>{RUBY}{long}</p>");
    let continuous = strip_lines(&body, "p { margin: 0; }").len();
    let pages = page_lines(&body, "p { margin: 0; }", 120.0);
    let placed: usize = pages.iter().map(Vec::len).sum();
    assert!(pages.len() > 1, "the paragraph splits: {pages:?}");
    assert_eq!(placed, continuous, "{pages:?}");
}

#[test]
#[ignore = "drill-down: RITO_DRILL_EPUB=<book> RITO_DRILL_CHAPTER=<idref> RITO_DRILL_PAGES=a-b"]
fn drill_pages() {
    let path = std::env::var("RITO_DRILL_EPUB").expect("book");
    let idref = std::env::var("RITO_DRILL_CHAPTER").expect("chapter");
    let pages = std::env::var("RITO_DRILL_PAGES").unwrap_or_else(|_| "0-2".to_owned());
    let (from, to) = pages.split_once('-').expect("a-b");
    let (from, to): (usize, usize) = (from.parse().unwrap(), to.parse().unwrap());
    let bytes = std::fs::read(path).expect("book reads");
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("document opens");
    let revision_id = document
        .create_revision(&layout())
        .expect("revision")
        .revision_id;
    let inline = ParleyInlineContext::new(vec![bundled_font("SourceHanSerifCN-Regular.otf")])
        .expect("font registers");
    let engine = BlockFormattingContext::new(inline);
    let built = document
        .chapter_formatting_tree(&revision_id, &idref)
        .expect("tree builds");
    let cancel = CancelFlag::new();
    let mut token: Option<BreakToken> = None;
    for page in 0..=to {
        let (fragment, next) =
            layout_chapter_page(&engine, &built.tree, 640.0, 850.0, token.as_ref(), &cancel)
                .expect("page lays out");
        if page >= from {
            fn walk(f: &Fragment, top: f64, depth: usize) {
                match f {
                    Fragment::Box(b) => {
                        eprintln!(
                            "{}box {:?} y={} h={}",
                            "  ".repeat(depth),
                            b.source,
                            top + b.rect.y,
                            b.rect.height
                        );
                        for c in &b.children {
                            walk(c, top + b.rect.y, depth + 1);
                        }
                    }
                    Fragment::Line(l) => eprintln!(
                        "{}line y={} h={} base={} growth={} overflow={} runs={:?}",
                        "  ".repeat(depth),
                        top + l.rect.y,
                        l.rect.height,
                        l.baseline,
                        l.ruby_growth,
                        l.ruby_overflow,
                        l.text_runs.first()
                    ),
                    _ => {}
                }
            }
            eprintln!(
                "=== page {page} token {:?}",
                token.as_ref().map(|t| (&t.resume_path, &t.stage))
            );
            walk(&fragment, 0.0, 0);
        }
        match next {
            Some(next) => token = Some(next),
            None => break,
        }
    }
}
