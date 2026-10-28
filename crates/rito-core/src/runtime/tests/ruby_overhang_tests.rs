//! A wide ruby annotation overhangs the text beside it on its own line
//! only, and a line the breaker ends by rewinding to an item boundary aligns
//! as if each ruby on it were its whole column wide, as Chromium lays them
//! out. Positions are Chromium's (the pinned serif at 18px in a 300px
//! column; the annotation "Fragment" is 68px over a 36px base and
//! overhangs 7px each side mid-line).

use rito_block::BlockFormattingContext;
use rito_fragment::{CancelFlag, Fragment, LineText};
use rito_inline::ParleyInlineContext;

use super::pinned_font_policy_fixtures::{bundled_font, content_epub, layout};
use crate::fragment_pagination::layout_chapter_strip;
use crate::runtime::RuntimeDocument;

const RUBY: &str = "<ruby>碎片<rt>Fragment</rt></ruby>";
const STYLE: &str = "p { width: 300px; margin: 0; text-indent: 0; font-size: 18px; \
                     line-height: 1.5; } rt { font-size: 0.8em; }";

/// Each glyph's (line, left) by its character index in the paragraph's
/// base text, with `align` as the paragraph's text-align.
fn glyphs(body: &str, align: &str) -> Vec<(usize, f64)> {
    let bytes = content_epub(
        "zh-CN",
        &format!("<p>{body}</p>"),
        &format!("{STYLE} p {{ text-align: {align}; }}"),
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
        LineText::All,
        &CancelFlag::new(),
    )
    .expect("strip lays out");
    let mut by_byte = Vec::new();
    collect(&strip, 0.0, &mut 0, &mut by_byte);
    by_byte.sort_by_key(|(byte, _, _)| *byte);
    by_byte.into_iter().map(|(_, line, x)| (line, x)).collect()
}

fn collect(fragment: &Fragment, left: f64, line: &mut usize, out: &mut Vec<(u32, usize, f64)>) {
    match fragment {
        Fragment::Box(block) => {
            for child in &block.children {
                collect(child, left + block.rect.x, line, out);
            }
        }
        Fragment::Line(row) => {
            for child in &row.children {
                if let Fragment::Text(run) = child {
                    for cluster in run.clusters.iter() {
                        out.push((
                            cluster.byte,
                            *line,
                            left + row.rect.x + run.rect.x + cluster.x,
                        ));
                    }
                }
            }
            *line += 1;
        }
        Fragment::Text(_) | Fragment::Image(_) => {}
    }
}

/// Within one LayoutUnit: the annotation's advance sums glyph advances
/// that Chromium takes from HarfBuzz in 16.16 fixed point, so its column
/// can end one LayoutUnit apart from the engine's (both glyph positions
/// raster in the same quarter-pixel bucket).
fn assert_at(glyphs: &[(usize, f64)], index: usize, line: usize, left: f64) {
    let (got_line, got_left) = glyphs[index];
    assert!(
        got_line == line && (got_left - left).abs() <= 1.0 / 64.0 + 1e-9,
        "glyph {index}: line {got_line} at {got_left}, Chromium puts it on line {line} at {left}"
    );
}

#[test]
fn a_ruby_opening_a_line_does_not_overhang_backwards() {
    // The column starts the line; only its end overhangs the next glyph.
    let glyphs = glyphs(
        &format!("{}{RUBY}{}", "灵".repeat(16), "附".repeat(20)),
        "left",
    );
    assert_eq!(
        glyphs[16].0, 1,
        "the ruby opens the second line: {glyphs:?}"
    );
    assert_at(&glyphs, 18, 1, 60.953125);
}

#[test]
fn a_ruby_mid_line_overhangs_both_neighbours() {
    let glyphs = glyphs(
        &format!("{}{RUBY}{}", "灵".repeat(5), "附".repeat(20)),
        "left",
    );
    assert_at(&glyphs, 7, 0, 143.953125);
}

#[test]
fn a_justified_line_closing_on_a_ruby_is_not_expanded() {
    // The next glyph does not fit: the breaker rewinds to the ruby's end
    // and counts the column whole, 302 against 300, so the line falls back
    // to start alignment.
    let glyphs = glyphs(
        &format!("{}{RUBY}{}", "灵".repeat(13), "附".repeat(20)),
        "justify",
    );
    assert_at(&glyphs, 1, 0, 18.0);
    assert_at(&glyphs, 15, 1, 0.0);
}

#[test]
fn a_justified_line_ending_at_an_element_counts_its_rubies_whole() {
    let glyphs = glyphs(
        &format!(
            "{}{RUBY}{}<span>{}</span>",
            "灵".repeat(3),
            "灵".repeat(10),
            "附".repeat(20)
        ),
        "justify",
    );
    assert_at(&glyphs, 5, 0, 107.953125);
    assert_at(&glyphs, 14, 0, 269.953125);
    assert_at(&glyphs, 15, 1, 0.0);
}

#[test]
fn a_ruby_overhangs_neither_a_line_break_nor_the_paragraph_end() {
    // Centered, the line is the base before it, the whole column less its
    // start overhang: 54 + 68 - 7, centered in 300.
    for after in ["<br/>附附附", ""] {
        let glyphs = glyphs(&format!("{}{RUBY}{after}", "灵".repeat(3)), "center");
        assert_at(&glyphs, 0, 0, 92.515625);
    }
    let glyphs = glyphs(&format!("{}{RUBY}附附附", "灵".repeat(3)), "center");
    assert_at(&glyphs, 0, 0, 69.015625);
}
