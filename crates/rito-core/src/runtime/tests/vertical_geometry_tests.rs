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
    // An opener after a stop or a closer gives up its blank top half, its
    // vertical half width: 『 takes 36 to 45, and 三 starts at 81 where
    // two full ems would put it at 90.
    Case {
        name: "vertical-punctuation-pairs",
        css: "",
        latin_primary: false,
        body: "<p>一。『二』三</p>",
        blocks: &[[327.0, 0.0, 27.0, 592.0]],
        columns: &[[332.0, 15.84, 96.84]],
        annotations: &[],
    },
    // A minimum width is a minimum block size across vertical lines: an
    // empty box keeps 40px of the page, a one-line paragraph 2em with its
    // line on the line-over side, and a minimum wins over a smaller
    // maximum (27px against 20px).
    Case {
        name: "vertical-min-max-block-size",
        css: "div { background: #ccc; }",
        latin_primary: false,
        body: "<div style=\"min-width: 40px\"></div>\
               <p style=\"margin: 0; min-width: 2em\">一</p>\
               <div style=\"min-width: 1.5em; max-width: 20px\">二二</div>\
               <p style=\"margin: 0\">三</p>",
        blocks: &[
            [332.0, 0.0, 40.0, 592.0],
            [296.0, 0.0, 36.0, 592.0],
            [269.0, 0.0, 27.0, 592.0],
            [242.0, 0.0, 27.0, 592.0],
        ],
        columns: &[
            [310.0, 15.84, 15.84],
            [274.0, 15.84, 33.84],
            [247.0, 15.84, 15.84],
        ],
        annotations: &[],
    },
    // An empty block that takes block space hands the space under the
    // line before it on to the next paragraph's annotations, so that
    // paragraph's line keeps its height; an empty block with no size
    // closes the space off and the next annotation grows its line by 6px.
    Case {
        name: "annotation-space-through-empty-blocks",
        css: "p { margin: 0; }",
        latin_primary: false,
        body: "<p>一</p><p style=\"min-width: 2em\"></p><p><ruby>宝<rt>ほう</rt></ruby>生</p>\
               <p></p><p><ruby>二<rt>に</rt></ruby>三</p>",
        blocks: &[
            [345.0, 0.0, 27.0, 592.0],
            [309.0, 0.0, 36.0, 592.0],
            [282.0, 0.0, 27.0, 592.0],
            [282.0, 0.0, 0.0, 592.0],
            [249.0, 0.0, 33.0, 592.0],
        ],
        columns: &[
            [350.0, 15.84, 15.84],
            [287.0, 15.84, 33.84],
            [254.0, 15.84, 33.84],
        ],
        // The 9px annotations' 13px text boxes span 303.5 to 316.5 and
        // 270.5 to 283.5 in Chromium's DOM.
        annotations: &[[305.5], [272.5]],
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

/// What each text command of the first page draws, one entry per glyph
/// origin: its family, the origin in the content box's coordinates, and
/// the horizontal scale a transform wrapped around it applies.
fn painted_strings(body: &str) -> Vec<(String, f64, f64, f64)> {
    painted_commands(body)
        .into_iter()
        .flat_map(|(family, origins, scale)| {
            origins
                .into_iter()
                .map(move |(x, y)| (family.clone(), x, y, scale))
        })
        .collect()
}

/// One text command as painted: its family, its glyph origins in the
/// content box's coordinates, and the horizontal scale a transform wrapped
/// around it applies.
type PaintedCommand = (String, Vec<(f64, f64)>, f64);

/// What each text command of the first page draws.
fn painted_commands(body: &str) -> Vec<PaintedCommand> {
    let bytes = content_epub(
        "ja",
        body,
        "html { writing-mode: vertical-rl; } body { margin: 0; font-size: 18px; line-height: 1.5; }",
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
    let commands = fragment_layout
        .page(0)
        .expect("first page")
        .commands_for(1.0)
        .expect("page paints");
    let mut scale = 1.0;
    let mut strings = Vec::new();
    for command in commands.iter() {
        match command {
            DisplayCommand::Transform { transforms, .. } => {
                for transform in transforms {
                    if let crate::render::contract::ReaderTransform::Scale { sx, .. } = transform {
                        scale = *sx;
                    }
                }
            }
            DisplayCommand::PopState => scale = 1.0,
            DisplayCommand::PaintText(text) => strings.push((
                text.paint.font.family.to_string(),
                text.clusters
                    .iter()
                    .map(|cluster| (cluster.x - ORIGIN, cluster.y - ORIGIN))
                    .collect(),
                scale,
            )),
            _ => {}
        }
    }
    strings
}

/// A `text-combine-upright: all` item sets as one horizontal string in an
/// em of the column, the box as wide as the font's 26px height over the
/// line's central baseline (341, so the box spans 328 to 354), the string
/// centred in it on the 1/64 grid and its baseline 21 - (26 - 18) / 2 =
/// 17px below the unit's top: `!?` in its own forms, `AB` (24.8px) in its
/// half-width forms, `2024` (39.6px, still 36 in half widths) scaled to
/// 1.1em from 3.1px in. Every character after a unit sits one em further
/// down. Measured on Chromium's DOM: a canvas drawing the strings there
/// matches it pixel for pixel.
#[test]
fn a_vertical_line_sets_combined_upright_items_as_chromium_does() {
    let combine = |text: &str| format!("<span style=\"text-combine-upright: all\">{text}</span>");
    let strings = painted_strings(&format!(
        "<p>一{}二{}三{}四</p>",
        combine("!?"),
        combine("AB"),
        combine("2024")
    ));
    let expected: [(&str, f64, f64, f64); 7] = [
        ("vert", 332.0, 15.84, 1.0),
        ("own", 334.328125, 35.0, 1.0),
        ("vert", 332.0, 51.84, 1.0),
        ("half", 332.0, 71.0, 1.0),
        ("vert", 332.0, 87.84, 1.0),
        ("own", 331.1, 107.0, 0.5),
        ("vert", 332.0, 123.84, 1.0),
    ];
    let close = strings.len() == expected.len()
        && strings
            .iter()
            .zip(&expected)
            .all(|((family, x, y, scale), (forms, ex, ey, escale))| {
                let forms_match = match *forms {
                    "vert" => family.starts_with("__RitoVert_"),
                    "half" => family.starts_with("__RitoHWID_"),
                    _ => ["__RitoVert_", "__RitoHWID_", "__RitoTWID_", "__RitoQWID_"]
                        .iter()
                        .all(|variant| !family.starts_with(variant)),
                };
                forms_match
                    && (x - ex).abs() < 1e-5
                    && (y - ey).abs() < 1e-5
                    && (scale - escale).abs() < 1e-5
            });
    assert!(close, "painted {strings:?}, Chromium {expected:?}");
}

/// A combined unit is one em a line never breaks inside: after 31 ems of
/// a 592px column, the two ideographs `一二` combined still fit (558 to
/// 576), where as two characters they would not, and the next character
/// opens the next column.
#[test]
fn a_combined_unit_takes_one_em_of_a_column_and_never_splits() {
    let strings = painted_strings(&format!(
        "<p>{}<span style=\"text-combine-upright: all\">一二</span>三</p>",
        "一".repeat(31)
    ));
    let tail: Vec<(f64, f64)> = strings
        .iter()
        .rev()
        .take(2)
        .rev()
        .map(|(_, x, y, _)| (*x, *y))
        .collect();
    assert_eq!(strings.len(), 33, "{strings:?}");
    assert!(
        (tail[0].1 - 575.0).abs() < 1e-6
            && (tail[1].0 - 305.0).abs() < 1e-6
            && (tail[1].1 - 15.84).abs() < 1e-6,
        "the unit and the character after it: {tail:?}"
    );
}

/// A span whose writing mode is not its line's lays out as an inline-block
/// across the column (Blink's `StyleAdjuster`): `!!` sets as a horizontal
/// line 11.09375px long in a box 1.2em (21.59375px on the 1/64 grid) down
/// the column, hung from a central baseline synthesized off the box, its
/// larger half (5.546875px) over the line's baseline at 341. The text's
/// baseline lies its font's 21px ascent less the 3px its negative half
/// leading floors to below the box's top. A span without a line height of
/// its own takes the paragraph's 27px. Measured on Chromium's DOM.
#[test]
fn a_vertical_line_sets_an_orthogonal_span_across_it_as_chromium_does() {
    let commands = painted_commands(
        "<p>一<span style=\"writing-mode: horizontal-tb; line-height: 1.2\">!!</span>二\
         <span style=\"writing-mode: horizontal-tb\">!?</span>三</p>",
    );
    let firsts: Vec<(f64, f64)> = commands
        .iter()
        .filter_map(|(_, origins, _)| origins.first().copied())
        .collect();
    let expected = [
        (332.0, 15.84),
        (335.453125, 36.0),
        (332.0, 55.43375),
        (334.34375, 79.0),
        (332.0, 100.43375),
    ];
    let close = firsts.len() == expected.len()
        && firsts
            .iter()
            .zip(&expected)
            .all(|((x, y), (ex, ey))| (x - ex).abs() < 1e-6 && (y - ey).abs() < 1e-6);
    assert!(close, "painted {firsts:?}, Chromium {expected:?}");
}
