//! Where a vertical-rl page puts its boxes and its glyphs, as Chromium 156
//! lays them out: the pinned serif at 18px with `line-height: 1.5`, on the
//! fixture page (a 372 × 592 content box 24px in from the page's top-left
//! corner), the chapter's body without margins. Every paragraph and
//! heading carries a background so its border box paints; the expected
//! boxes are the elements' `getBoundingClientRect()` in a 372 × 592
//! viewport. Each column's glyphs hang from the line's central baseline:
//! the line-over edge less the line's central ascent (half the font's
//! whole-pixel height, rounded up, plus the floored half-leading) plus
//! half that height, less half the em; each sits its face's vertical
//! origin (0.88 em) below its place down the column. A canvas drawing the
//! glyphs there matches Chromium's DOM column pixel for pixel.

use super::fixture::layout;
use super::pinned_font_policy_fixtures::{bundled_font, content_epub, face, policy};
use crate::render::DisplayCommand;
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole};

/// The page's content-box origin on the fixture page.
const ORIGIN: f64 = 24.0;

/// What the first page paints, in the content box's coordinates: each
/// decorated box's border box, and each column of text's glyph origin
/// across and its first and last glyph origins down.
struct Painted {
    blocks: Vec<[f64; 4]>,
    columns: Vec<[f64; 3]>,
}

/// The pinned faces: the serif alone, or — with `latin_primary` — Tinos
/// ahead of it, so the Latin face is every run's primary font and the
/// ideographs fall back to the serif.
fn painted(body: &str, css: &str, latin_primary: bool) -> Painted {
    let bytes = content_epub(
        "ja",
        body,
        &format!(
            "html {{ writing-mode: vertical-rl; }} \
             body {{ margin: 0; font-size: 18px; line-height: 1.5; }} \
             p, h1 {{ background: #eee; }} {css}"
        ),
        None,
    );
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(
            latin_primary
                .then(|| {
                    face(
                        bundled_font("Tinos-Regular.ttf"),
                        RuntimePinnedFontGenericRole::Serif,
                        None,
                    )
                })
                .into_iter()
                .chain([face(
                    bundled_font("SourceHanSerifCN-Regular.otf"),
                    RuntimePinnedFontGenericRole::Serif,
                    Some("ja"),
                )])
                .collect(),
        ),
    )
    .expect("document opens");
    let summary = document.create_revision(&layout()).expect("revision");
    let fragment_layout = &document.revisions[&summary.revision_id].fragment_layout;
    let page = fragment_layout.page(0).expect("first page");
    let commands = page.commands_for(1.0).expect("page paints");
    let mut painted = Painted {
        blocks: Vec::new(),
        columns: Vec::new(),
    };
    for command in commands.iter() {
        match command {
            DisplayCommand::PaintBlock { rect, .. } => {
                painted
                    .blocks
                    .push([rect.x - ORIGIN, rect.y - ORIGIN, rect.width, rect.height])
            }
            DisplayCommand::PaintText(text) => {
                if let (Some(first), Some(last)) = (text.clusters.first(), text.clusters.last()) {
                    painted
                        .columns
                        .push([first.x - ORIGIN, first.y - ORIGIN, last.y - ORIGIN]);
                }
            }
            _ => {}
        }
    }
    painted
}

fn assert_close<const N: usize>(case: &str, what: &str, got: &[[f64; N]], expected: &[[f64; N]]) {
    let close = got.len() == expected.len()
        && got
            .iter()
            .zip(expected)
            .all(|(got, expected)| got.iter().zip(expected).all(|(a, b)| (a - b).abs() < 1e-6));
    assert!(close, "{case}: {what} {got:?}, Chromium {expected:?}");
}

struct Case {
    name: &'static str,
    css: &'static str,
    body: &'static str,
    latin_primary: bool,
    blocks: &'static [[f64; 4]],
    columns: &'static [[f64; 3]],
}

const CASES: &[Case] = &[
    // The UA's `margin-block: 1em` lands on the physical right and left,
    // and adjoining paragraphs collapse it to one 18px gap.
    Case {
        name: "ua-paragraphs",
        css: "",
        latin_primary: false,
        body: "<p>一一一一一</p><p>二二二</p><p>三</p>",
        blocks: &[
            [327.0, 0.0, 27.0, 592.0],
            [282.0, 0.0, 27.0, 592.0],
            [237.0, 0.0, 27.0, 592.0],
        ],
        columns: &[
            [332.0, 15.84, 87.84],
            [287.0, 15.84, 51.84],
            [242.0, 15.84, 15.84],
        ],
    },
    // Physical margins, padding and borders keep their sides: the right
    // margin is block-start and collapses with the paragraph before, the
    // top padding pushes the text down the column.
    Case {
        name: "box-edges",
        css: "",
        latin_primary: false,
        body: "<p>一一</p><div style=\"margin: 5px 15px 25px 35px; \
               padding: 10px 20px 30px 40px; border: 2px solid #000; background: #ccc\">\
               <p style=\"margin: 0\">二二二</p></div><p>三</p>",
        blocks: &[
            [327.0, 0.0, 27.0, 592.0],
            [218.0, 5.0, 91.0, 562.0],
            [260.0, 17.0, 27.0, 518.0],
            [156.0, 0.0, 27.0, 592.0],
        ],
        columns: &[
            [332.0, 15.84, 33.84],
            [265.0, 32.84, 68.84],
            [161.0, 15.84, 15.84],
        ],
    },
    // A heading's 0.67em margins on the 1/64 grid.
    Case {
        name: "heading",
        css: "",
        latin_primary: false,
        body: "<h1>一一</h1><p>二二二</p>",
        blocks: &[
            [293.890625, 0.0, 54.0, 592.0],
            [242.78125, 0.0, 27.0, 592.0],
        ],
        // The heading's 51px font height leaves one pixel of leading above
        // its text box: its glyphs centre 26.5px in from the line's edge.
        columns: &[[303.390625, 31.68, 67.68], [247.78125, 15.84, 51.84]],
    },
    // The body's top and bottom margins shorten the columns.
    Case {
        name: "body-margin",
        css: "body { margin: 8px 20px 30px 40px; }",
        latin_primary: false,
        body: "<p>一一</p>",
        blocks: &[[325.0, 8.0, 27.0, 554.0]],
        columns: &[[330.0, 23.84, 41.84]],
    },
    // The indent starts the first column 1em down; the second column
    // wraps to the left of it.
    Case {
        name: "indent-and-wrap",
        css: "",
        latin_primary: false,
        body: "<p style=\"text-indent: 1em\">\
               一一一一一一一一一一一一一一一一一一一一一一一一一\
               一一一一一一一一一一一一一一一一一一一一一一一一一</p>",
        blocks: &[[300.0, 0.0, 54.0, 592.0]],
        columns: &[[332.0, 33.84, 573.84], [305.0, 15.84, 339.84]],
    },
    // A top margin is an inline-start indent; a top padding moves the
    // text but not the box.
    Case {
        name: "start-indent",
        css: ".start-3em { margin-top: 3em; }",
        latin_primary: false,
        body: "<p class=\"start-3em\">一一一</p><p style=\"padding-top: 2em\">二二</p>",
        blocks: &[[327.0, 54.0, 27.0, 538.0], [282.0, 0.0, 27.0, 592.0]],
        columns: &[[332.0, 69.84, 105.84], [287.0, 51.84, 69.84]],
    },
    // A Latin primary font: the run's text box and alphabetic baseline
    // are Tinos's (16px ascent, 20px tall at 18px), and each ideograph
    // centres on its own font's central baseline, 8px back towards the
    // line-over edge from there: 11px in from the line's edge.
    Case {
        name: "latin-primary",
        css: "",
        latin_primary: true,
        body: "<p>一一一</p>",
        blocks: &[[327.0, 0.0, 27.0, 592.0]],
        columns: &[[334.0, 15.84, 51.84]],
    },
];

#[test]
fn a_vertical_rl_page_places_boxes_and_glyphs_as_chromium_does() {
    for case in CASES {
        let painted = painted(case.body, case.css, case.latin_primary);
        assert_close(case.name, "boxes", &painted.blocks, case.blocks);
        assert_close(case.name, "columns", &painted.columns, case.columns);
    }
}
