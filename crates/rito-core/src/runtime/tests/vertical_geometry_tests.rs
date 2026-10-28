//! Where a vertical-rl page puts its boxes and its text, as Chromium 156
//! lays them out: the pinned serif at 18px with `line-height: 1.5`, on the
//! fixture page (a 372 × 592 content box 24px in from the page's top-left
//! corner), the chapter's body without margins. Every paragraph and
//! heading carries a background so its border box paints; the expected
//! rectangles are the elements' `getBoundingClientRect()` and the text's
//! `Range.getClientRects()` in a 372 × 592 viewport.

use super::fixture::layout;
use super::pinned_font_policy_fixtures::{bundled_font, content_epub, face, policy};
use crate::render::DisplayCommand;
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole};

/// The page's content-box origin on the fixture page.
const ORIGIN: f64 = 24.0;

/// What the first page paints, in the content box's coordinates: each
/// decorated box's border box, and each text run's extent down its
/// column (top and length).
struct Painted {
    blocks: Vec<[f64; 4]>,
    runs: Vec<[f64; 2]>,
}

fn painted(body: &str, css: &str) -> Painted {
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
        policy(vec![face(
            bundled_font("SourceHanSerifCN-Regular.otf"),
            RuntimePinnedFontGenericRole::Serif,
            Some("ja"),
        )]),
    )
    .expect("document opens");
    let summary = document.create_revision(&layout()).expect("revision");
    let fragment_layout = &document.revisions[&summary.revision_id].fragment_layout;
    let page = fragment_layout.page(0).expect("first page");
    let commands = page.commands_for(1.0).expect("page paints");
    let mut painted = Painted {
        blocks: Vec::new(),
        runs: Vec::new(),
    };
    for command in commands.iter() {
        match command {
            DisplayCommand::PaintBlock { rect, .. } => {
                painted
                    .blocks
                    .push([rect.x - ORIGIN, rect.y - ORIGIN, rect.width, rect.height])
            }
            DisplayCommand::PaintText(text) => {
                painted.runs.push([text.rect.y - ORIGIN, text.rect.height])
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
    blocks: &'static [[f64; 4]],
    runs: &'static [[f64; 2]],
}

const CASES: &[Case] = &[
    // The UA's `margin-block: 1em` lands on the physical right and left,
    // and adjoining paragraphs collapse it to one 18px gap.
    Case {
        name: "ua-paragraphs",
        css: "",
        body: "<p>一一一一一</p><p>二二二</p><p>三</p>",
        blocks: &[
            [327.0, 0.0, 27.0, 592.0],
            [282.0, 0.0, 27.0, 592.0],
            [237.0, 0.0, 27.0, 592.0],
        ],
        runs: &[[0.0, 90.0], [0.0, 54.0], [0.0, 18.0]],
    },
    // Physical margins, padding and borders keep their sides: the right
    // margin is block-start and collapses with the paragraph before, the
    // top padding pushes the text down the column.
    Case {
        name: "box-edges",
        css: "",
        body: "<p>一一</p><div style=\"margin: 5px 15px 25px 35px; \
               padding: 10px 20px 30px 40px; border: 2px solid #000; background: #ccc\">\
               <p style=\"margin: 0\">二二二</p></div><p>三</p>",
        blocks: &[
            [327.0, 0.0, 27.0, 592.0],
            [218.0, 5.0, 91.0, 562.0],
            [260.0, 17.0, 27.0, 518.0],
            [156.0, 0.0, 27.0, 592.0],
        ],
        runs: &[[0.0, 36.0], [17.0, 54.0], [0.0, 18.0]],
    },
    // A heading's 0.67em margins on the 1/64 grid.
    Case {
        name: "heading",
        css: "",
        body: "<h1>一一</h1><p>二二二</p>",
        blocks: &[
            [293.890625, 0.0, 54.0, 592.0],
            [242.78125, 0.0, 27.0, 592.0],
        ],
        runs: &[[0.0, 72.0], [0.0, 54.0]],
    },
    // The body's top and bottom margins shorten the columns.
    Case {
        name: "body-margin",
        css: "body { margin: 8px 20px 30px 40px; }",
        body: "<p>一一</p>",
        blocks: &[[325.0, 8.0, 27.0, 554.0]],
        runs: &[[8.0, 36.0]],
    },
    // The indent starts the first column 1em down; the second column
    // wraps to the left of it.
    Case {
        name: "indent-and-wrap",
        css: "",
        body: "<p style=\"text-indent: 1em\">\
               一一一一一一一一一一一一一一一一一一一一一一一一一\
               一一一一一一一一一一一一一一一一一一一一一一一一一</p>",
        blocks: &[[300.0, 0.0, 54.0, 592.0]],
        runs: &[[18.0, 558.0], [0.0, 342.0]],
    },
    // A top margin is an inline-start indent; a top padding moves the
    // text but not the box.
    Case {
        name: "start-indent",
        css: ".start-3em { margin-top: 3em; }",
        body: "<p class=\"start-3em\">一一一</p><p style=\"padding-top: 2em\">二二</p>",
        blocks: &[[327.0, 54.0, 27.0, 538.0], [282.0, 0.0, 27.0, 592.0]],
        runs: &[[54.0, 54.0], [36.0, 36.0]],
    },
];

#[test]
fn a_vertical_rl_page_places_boxes_and_columns_as_chromium_does() {
    for case in CASES {
        let painted = painted(case.body, case.css);
        assert_close(case.name, "boxes", &painted.blocks, case.blocks);
        assert_close(case.name, "column runs", &painted.runs, case.runs);
    }
}
