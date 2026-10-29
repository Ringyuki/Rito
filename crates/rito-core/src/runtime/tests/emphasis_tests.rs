//! Where emphasis marks put a paragraph's lines, as Chromium 156 lays
//! them out: the pinned serif at 16px on the fixture page (a 372 × 592
//! content box), the chapter's body without margins. A mark half the
//! text's size stands outside the em box of the text it marks; marks over
//! a line push it down by what the room under the previous line's text
//! does not absorb, marks under a line grow its box, and the next line
//! rises into that growth by as much as the room above its own text. The
//! expected boxes are the paragraphs' `getBoundingClientRect()` in a
//! 372 × 592 viewport.

use super::fixture::layout;
use super::pinned_font_policy_fixtures::{bundled_font, content_epub, face, policy};
use crate::render::DisplayCommand;
use crate::runtime::{RuntimeDocument, RuntimePinnedFontGenericRole};

/// The page's content-box origin on the fixture page.
const ORIGIN: f64 = 24.0;

/// What the first page paints: each paragraph's border box and the
/// centre of each emphasis mark's outline.
fn painted(body: &str, css: &str) -> (Vec<[f64; 4]>, Vec<[f64; 2]>) {
    let bytes = content_epub(
        "zh-CN",
        body,
        &format!("body {{ margin: 0; font-size: 16px; }} p {{ background: #eee; }} {css}"),
        None,
    );
    let mut document = RuntimeDocument::open_with_pinned_font_policy(
        &bytes,
        policy(vec![face(
            bundled_font("SourceHanSerifCN-Regular.otf"),
            RuntimePinnedFontGenericRole::Serif,
            None,
        )]),
    )
    .expect("document opens");
    let summary = document.create_revision(&layout()).expect("revision");
    let page = document.revisions[&summary.revision_id]
        .fragment_layout
        .page(0)
        .expect("page lays out");
    let mut boxes = Vec::new();
    let mut marks = Vec::new();
    for command in page.commands_for(1.0).expect("page paints").iter() {
        match command {
            DisplayCommand::PaintBlock { rect, .. } => {
                boxes.push([rect.x - ORIGIN, rect.y - ORIGIN, rect.width, rect.height]);
            }
            // The pinned serif's filled circle at 8px: its outline centres
            // 4 right of its origin and 3.04 above it.
            DisplayCommand::PaintRuby(marks_run) => marks.extend(
                marks_run
                    .clusters
                    .iter()
                    .map(|mark| [mark.x - ORIGIN + 4.0, mark.y - ORIGIN - 3.04]),
            ),
            _ => {}
        }
    }
    (boxes, marks)
}

fn paragraph_boxes(body: &str, css: &str) -> Vec<[f64; 4]> {
    painted(body, css).0
}

struct Case {
    name: &'static str,
    css: &'static str,
    body: &'static str,
    boxes: &'static [[f64; 4]],
}

const CASES: &[Case] = &[
    // Dots under a 20.796875px line reach 26 below its top (its em box
    // ends at 18, the mark is 8 tall): the box grows by the rest, and
    // the margins around it stay whole.
    Case {
        name: "marks-under-one-line",
        css: "p { line-height: 1.3; margin: 6.4px 0; } \
              .e { text-emphasis: circle; text-emphasis-position: under; }",
        body: "<p>这是前一段的文字。</p><p>甲乙<span class=\"e\">丙丁戊己</span>。</p>\
               <p>这是后一段的文字。</p>",
        boxes: &[
            [0.0, 6.390625, 372.0, 20.796875],
            [0.0, 33.578125, 372.0, 26.0],
            [0.0, 65.96875, 372.0, 20.796875],
        ],
    },
    // The second line rises one pixel into the first's growth: the room
    // above its own text.
    Case {
        name: "marks-under-two-lines",
        css: "p { line-height: 1.3; margin: 0; } \
              .e { text-emphasis: circle; text-emphasis-position: under; }",
        body: "<p><span class=\"e\">一二三四五六七八九十一二三四五六七八九十一二三四五</span>\
               六七八九十一二三四五六七八九十</p><p>后一段。</p>",
        boxes: &[[0.0, 0.0, 372.0, 51.0], [0.0, 51.0, 372.0, 20.796875]],
    },
    // The marks spend the bottom padding before the box grows.
    Case {
        name: "marks-under-into-padding",
        css: "p { line-height: 1.3; margin: 0; } .pad { padding-bottom: 3px; } \
              .e { text-emphasis: circle; text-emphasis-position: under; }",
        body: "<p class=\"pad\"><span class=\"e\">甲乙丙</span></p><p>后一段。</p>",
        boxes: &[[0.0, 0.0, 372.0, 26.0], [0.0, 26.0, 372.0, 20.796875]],
    },
    // A 16px line leaves no room under its text: dots over the next line
    // push it down their whole 9px past its top, a first line and an
    // interior one alike.
    Case {
        name: "marks-over-tight-lines",
        css: "p { line-height: 1; margin: 0; } .e { text-emphasis: filled dot; }",
        body: "<p>前一段。</p><p>甲<span class=\"e\">乙丙</span>丁</p>\
               <p>一二三四五六七八九十一二三四五六七八九十一二三四五\
               <span class=\"e\">六七</span>八九十</p>",
        boxes: &[
            [0.0, 0.0, 372.0, 16.0],
            [0.0, 16.0, 372.0, 25.0],
            [0.0, 41.0, 372.0, 41.0],
        ],
    },
    // A 28px column leaves room enough on its left for sesames over the
    // next column's text.
    Case {
        name: "sesames-over-roomy-columns",
        css: "html { writing-mode: vertical-rl; } p { line-height: 1.75; margin: 0; } \
              .e { text-emphasis: filled sesame; }",
        body: "<p>前一段。</p><p>甲<span class=\"e\">乙丙</span>丁</p>",
        boxes: &[[344.0, 0.0, 28.0, 592.0], [316.0, 0.0, 28.0, 592.0]],
    },
    // A 19.1875px column leaves 1.1875 of room left of its text; the
    // sesames reach 7 right of the next column, which moves left by the
    // rest.
    Case {
        name: "sesames-over-tight-columns",
        css: "html { writing-mode: vertical-rl; } p { line-height: 1.2; margin: 0; } \
              .e { text-emphasis: filled sesame; }",
        body: "<p>前一段。</p><p>甲<span class=\"e\">乙丙</span>丁</p>\
               <p>一二三四五六七八九十一二三四五六七八九十一二三四五六七八九十\
               一二三四五六七八九十<span class=\"e\">六七</span>八九十</p>",
        boxes: &[
            [352.8125, 0.0, 19.1875, 592.0],
            [327.8125, 0.0, 25.0, 592.0],
            [283.625, 0.0, 44.1875, 592.0],
        ],
    },
];

#[test]
fn emphasis_marks_place_lines_as_chromium_does() {
    for case in CASES {
        let got = paragraph_boxes(case.body, case.css);
        let close = got.len() == case.boxes.len()
            && got
                .iter()
                .zip(case.boxes)
                .all(|(got, expected)| got.iter().zip(expected).all(|(a, b)| (a - b).abs() < 1e-6));
        assert!(close, "{}: {got:?}, Chromium {:?}", case.name, case.boxes);
    }
}

/// Filled circles (whose ink centroid is their outline's centre) after a
/// 28px line: a horizontal line's under its text, a vertical line's on
/// either side of its column. The expected centres are the centroids of
/// Chromium's mark ink (its screenshot with the marks less without).
#[test]
fn emphasis_marks_paint_where_chromium_paints_them() {
    let body = "<p>前一段。</p><p>甲<span class=\"e\">乙丙</span>丁</p>";
    let cases: [(&str, &str, [[f64; 2]; 2]); 3] = [
        (
            "under-a-horizontal-line",
            "p { line-height: 1.75; margin: 0; } \
             .e { text-emphasis: circle; text-emphasis-position: under; }",
            [[24.0, 54.92], [40.0, 54.92]],
        ),
        (
            "right-of-a-column",
            "html { writing-mode: vertical-rl; } p { line-height: 1.75; margin: 0; } \
             .e { text-emphasis: filled circle; }",
            [[343.5, 23.91], [343.5, 39.91]],
        ),
        (
            "left-of-a-column",
            "html { writing-mode: vertical-rl; } p { line-height: 1.75; margin: 0; } \
             .e { text-emphasis: filled circle; text-emphasis-position: left over; }",
            [[317.5, 23.91], [317.5, 39.91]],
        ),
    ];
    for (name, css, expected) in cases {
        let (_, marks) = painted(body, css);
        // Anti-aliasing pulls an ink centroid a tenth of a pixel.
        let close = marks.len() == expected.len()
            && marks.iter().zip(&expected).all(|(got, want)| {
                (got[0] - want[0]).abs() < 0.15 && (got[1] - want[1]).abs() < 0.15
            });
        assert!(close, "{name}: {marks:?}, Chromium {expected:?}");
    }
}
