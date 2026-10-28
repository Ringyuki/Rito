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
/// decorated box's border box, each column of text's glyph origin across
/// and its first and last glyph origins down, and each ruby annotation's
/// glyph origin across.
struct Painted {
    blocks: Vec<[f64; 4]>,
    columns: Vec<[f64; 3]>,
    annotations: Vec<[f64; 1]>,
    /// The family every column run and annotation paints in.
    families: Vec<String>,
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
        annotations: Vec::new(),
        families: Vec::new(),
    };
    for command in commands.iter() {
        match command {
            DisplayCommand::PaintBlock { rect, .. } => {
                painted
                    .blocks
                    .push([rect.x - ORIGIN, rect.y - ORIGIN, rect.width, rect.height])
            }
            DisplayCommand::PaintText(text) => {
                painted.families.push(text.paint.font.family.to_string());
                // A column's text may come in several commands, one per
                // stretch layout placed; they read as one column.
                if let (Some(first), Some(last)) = (text.clusters.first(), text.clusters.last()) {
                    let (x, top, bottom) = (first.x - ORIGIN, first.y - ORIGIN, last.y - ORIGIN);
                    match painted.columns.last_mut() {
                        Some(column) if (column[0] - x).abs() < 1e-6 && column[2] < top => {
                            column[2] = bottom;
                        }
                        _ => painted.columns.push([x, top, bottom]),
                    }
                }
            }
            DisplayCommand::PaintRuby(ruby) => {
                painted.families.push(ruby.paint.font.family.to_string());
                if let Some(first) = ruby.clusters.first() {
                    painted.annotations.push([first.x - ORIGIN]);
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
    annotations: &'static [[f64; 1]],
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
        annotations: &[],
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
        annotations: &[],
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
        annotations: &[],
    },
    // The body's top and bottom margins shorten the columns.
    Case {
        name: "body-margin",
        css: "body { margin: 8px 20px 30px 40px; }",
        latin_primary: false,
        body: "<p>一一</p>",
        blocks: &[[325.0, 8.0, 27.0, 554.0]],
        columns: &[[330.0, 23.84, 41.84]],
        annotations: &[],
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
        annotations: &[],
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
        annotations: &[],
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
        annotations: &[],
    },
    // A first line's annotation stands on its base's em box, reaching
    // into the paragraph's 1em top margin: the line does not grow. Its
    // 13px-high text box rides the half pixel an odd height leaves, so its
    // glyphs centre at 355.
    Case {
        name: "ruby-borrows-the-margin",
        css: "",
        latin_primary: false,
        body: RUBY_BODY,
        blocks: &[
            [327.0, 0.0, 27.0, 592.0],
            [282.0, 0.0, 27.0, 592.0],
            [237.0, 0.0, 27.0, 592.0],
        ],
        columns: RUBY_18_COLUMNS,
        annotations: &[[350.5]],
    },
    Case {
        name: "ruby-borrows-the-margin-latin-primary",
        css: "body { font-size: 16px; line-height: 1.75; }",
        latin_primary: true,
        body: RUBY_BODY,
        blocks: &[
            [328.0, 0.0, 28.0, 592.0],
            [284.0, 0.0, 28.0, 592.0],
            [240.0, 0.0, 28.0, 592.0],
        ],
        columns: RUBY_16_LATIN_COLUMNS,
        annotations: &[[351.5]],
    },
    // Without a margin to reach into the line grows by the 2.5px the
    // annotation stands past its strut.
    Case {
        name: "ruby-grows-the-line",
        css: "body { font-size: 16px; line-height: 1.75; } p { margin: 0; }",
        latin_primary: true,
        body: RUBY_BODY,
        blocks: &[
            [341.5, 0.0, 30.5, 592.0],
            [313.5, 0.0, 28.0, 592.0],
            [285.5, 0.0, 28.0, 592.0],
        ],
        columns: RUBY_16_LATIN_P0_COLUMNS,
        annotations: &[[365.0]],
    },
    // An inner line's annotation reaches into the 6px the line before
    // leaves under its text's em box: the paragraph keeps its three 28px
    // lines.
    Case {
        name: "inner-ruby-latin-primary",
        css: "body { font-size: 16px; line-height: 1.75; } p { margin: 0; }",
        latin_primary: true,
        body: INNER_RUBY_BODY,
        blocks: &[[288.0, 0.0, 84.0, 592.0], [260.0, 0.0, 28.0, 592.0]],
        columns: &[
            [351.5, 14.08, 590.08],
            [323.5, 14.08, 590.08],
            [295.5, 14.08, 46.08],
            [267.5, 14.08, 46.08],
        ],
        annotations: &[[339.5]],
    },
    Case {
        name: "inner-ruby",
        css: "body { font-size: 16px; line-height: 1.75; } p { margin: 0; }",
        latin_primary: false,
        body: INNER_RUBY_BODY,
        blocks: &[[288.0, 0.0, 84.0, 592.0], [260.0, 0.0, 28.0, 592.0]],
        columns: &[
            [350.5, 14.08, 590.08],
            [322.5, 14.08, 590.08],
            [294.5, 14.08, 46.08],
            [266.5, 14.08, 46.08],
        ],
        annotations: &[[338.5]],
    },
    // Upright kana shape top to bottom: the horizontal kerning the face
    // gives アッ or ルパ does not apply, every glyph a whole em on.
    Case {
        name: "kana-shape-top-to-bottom",
        css: "body { font-size: 16px; line-height: 1.75; } p { margin: 0; }",
        latin_primary: true,
        body: "<p>アップルパイも美味しいけど</p>",
        blocks: &[[344.0, 0.0, 28.0, 592.0]],
        columns: &[[351.5, 14.08, 206.08]],
        annotations: &[],
    },
];

/// A full first line, then a ruby on the second.
const INNER_RUBY_BODY: &str = "<p>一一一一一一一一一一一一一一一一一一一一一一一一一一一一一一一一一一一一一\
    二二<ruby>漢字<rt>かんじ</rt></ruby>二二二二二二二二二二二二二二二二二二二二二二二二二二二二二二二二二\
    三三三</p><p>四四四</p>";

const RUBY_BODY: &str = "<p>一一<ruby>漢字<rt>かんじ</rt></ruby>一一一</p><p>二二二</p><p>三</p>";

#[test]
fn a_vertical_rl_page_places_boxes_and_glyphs_as_chromium_does() {
    for case in CASES {
        let painted = painted(case.body, case.css, case.latin_primary);
        assert_close(case.name, "boxes", &painted.blocks, case.blocks);
        assert_close(case.name, "columns", &painted.columns, case.columns);
        assert_close(
            case.name,
            "annotations",
            &painted.annotations,
            case.annotations,
        );
        // Upright glyphs draw in their face's vertical forms.
        assert!(
            painted
                .families
                .iter()
                .all(|family| family.starts_with("__RitoVert_")),
            "{}: {:?}",
            case.name,
            painted.families
        );
    }
}

/// The ruby paragraph's column at 18px, then the two paragraphs after.
const RUBY_18_COLUMNS: &[[f64; 3]] = &[
    [332.0, 15.84, 123.84],
    [287.0, 15.84, 51.84],
    [242.0, 15.84, 15.84],
];

/// The same at 16px under a Latin primary font: the ideographs centre
/// 12.5px in from each line's edge.
const RUBY_16_LATIN_COLUMNS: &[[f64; 3]] = &[
    [335.5, 14.08, 110.08],
    [291.5, 14.08, 46.08],
    [247.5, 14.08, 14.08],
];

/// The same with the ruby line grown by 2.5px.
const RUBY_16_LATIN_P0_COLUMNS: &[[f64; 3]] = &[
    [349.0, 14.08, 110.08],
    [321.0, 14.08, 46.08],
    [293.0, 14.08, 14.08],
];
