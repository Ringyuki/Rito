//! Row spans must preserve column meaning and the combined cell height.
use super::pinned_font_policy_fixtures::{content_epub, layout};
use super::revisions::revision_by_id;
use crate::runtime::page_artifact::PageArtifactRect;
use crate::runtime::RuntimeDocument;

fn cells(body: &str) -> Vec<(String, PageArtifactRect)> {
    let bytes = content_epub(
        "en",
        body,
        "table { border-spacing:0; } td,th { padding:2px; border:1px solid black; }",
        None,
    );
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("open");
    let mut config = layout();
    config.viewport_width = 900.0;
    config.page_width = 900.0;
    let revision = document.create_revision(&config).expect("revision");
    let session = revision_by_id(&document, &revision.revision_id).chapter_engine_session();
    session
        .page(0)
        .expect("page")
        .semantic_nodes()
        .into_iter()
        .filter_map(|n| n.text.map(|text| (text, n.bounds)))
        .collect()
}

fn cell<'a>(cells: &'a [(String, PageArtifactRect)], text: &str) -> &'a PageArtifactRect {
    &cells
        .iter()
        .rev()
        .find(|(t, _)| t == text)
        .unwrap_or_else(|| panic!("cell {text}"))
        .1
}

#[test]
fn rowspan_header_keeps_the_second_row_under_the_fourth_column() {
    let cells=cells("<table><tbody><tr><th rowspan='2'>OS</th><th rowspan='2'>Adobe</th><th rowspan='2'>iBooks</th><th>Readium</th><th rowspan='2'>Kindle</th></tr><tr><th>MS-Mincho</th></tr><tr><td>A</td><td>B</td><td>C</td><td>D</td><td>E</td></tr></tbody></table>");
    let upper = cell(&cells, "Readium");
    let lower = cell(&cells, "MS-Mincho");
    assert!(
        (upper.x - lower.x).abs() < 1e-6,
        "second-row header must stay in column four"
    );
    assert!((cell(&cells, "D").x - lower.x).abs() < 1e-6);
    assert!(
        (cell(&cells, "OS").height - (lower.y + lower.height - upper.y)).abs() < 1e-6,
        "the spanning header must cover both rows"
    );
}

#[test]
fn rowspan_and_colspan_reserve_their_entire_rectangle() {
    let cells=cells("<table><tr><td rowspan='2' colspan='2'>Span</td><td>Top</td><td rowspan='2'>Right</td></tr><tr><td>Lower</td></tr><tr><td>A</td><td>B</td><td>C</td><td>D</td></tr></table>");
    assert!((cell(&cells, "Lower").x - cell(&cells, "C").x).abs() < 1e-6);
    assert!(cell(&cells, "Lower").x >= cell(&cells, "Span").x + cell(&cells, "Span").width);
    assert!((cell(&cells, "Right").x - cell(&cells, "D").x).abs() < 1e-6);
}

#[test]
fn zero_rowspan_stops_at_its_row_group() {
    let cells=cells("<table><tbody><tr><td rowspan='0'>Span</td><td>First</td></tr><tr><td>Second</td></tr></tbody><tbody><tr><td>New</td><td>Last</td></tr></tbody></table>");
    assert!((cell(&cells, "First").x - cell(&cells, "Second").x).abs() < 1e-6);
    assert!((cell(&cells, "New").x - cell(&cells, "Span").x).abs() < 1e-6);
    assert!(
        (cell(&cells, "Span").y + cell(&cells, "Span").height
            - (cell(&cells, "Second").y + cell(&cells, "Second").height))
            .abs()
            < 1e-6
    );
}

#[test]
fn rowspan_continuation_preserves_source_selection_and_marks_after_reflow() {
    use super::revisions::exact_source_range;
    use crate::runtime::{
        AnnotationTargetResolution, RuntimeExactSourceRangeRequest,
        RuntimeExactSourceRangeResolution, RuntimeTextCaretResolution, RuntimeTextPointRequest,
        RuntimeTextRangeFromPointsResolution, RuntimeTextRangeToPointRequest,
    };
    // PaintText uses its line box; highlight height follows the font
    // metrics. Compare their relative alignment with an ordinary paragraph
    // at the same size, rather than requiring those different boxes to match.
    fn paragraph_alignment(config: &crate::layout::LayoutConfig) -> [f64; 4] {
        use crate::runtime::{RuntimeSourcePoint, RuntimeSourceRange};
        let bytes = content_epub("en", "<p>Row 23</p>", "body,p { margin:0; }", None);
        let mut control = RuntimeDocument::open_pinned_for_tests(&bytes).expect("control");
        let rev = control.create_revision(config).expect("control revision");
        let frame = revision_by_id(&control, &rev.revision_id)
            .chapter_engine_session()
            .frame(0, 1.0)
            .expect("paint")
            .expect("frame");
        let paint = frame
            .commands
            .iter()
            .find_map(|command| match command {
                crate::render::DisplayCommand::PaintText(run) if &*run.text == "Row 23" => {
                    Some(run.rect)
                }
                _ => None,
            })
            .expect("control paint");
        let RuntimeExactSourceRangeResolution::Resolved { range } = exact_source_range(
            &mut control,
            &rev.revision_id,
            RuntimeExactSourceRangeRequest {
                href: "chapter.xhtml".to_owned(),
                source_range: RuntimeSourceRange {
                    start: RuntimeSourcePoint {
                        node_path: vec![0, 0],
                        text_offset: 0,
                    },
                    end: RuntimeSourcePoint {
                        node_path: vec![0, 0],
                        text_offset: 6,
                    },
                },
            },
        )
        .expect("control projection") else {
            panic!("control range")
        };
        let rect = range.rects[0];
        [
            rect.x - paint.x + config.margin_left,
            rect.y - paint.y + config.margin_top,
            rect.width - paint.width,
            rect.height - paint.height,
        ]
    }
    let mut body = String::from("<table><tbody>");
    for row in 0..30 {
        body.push_str("<tr>");
        if row == 0 {
            body.push_str("<th rowspan='30'>Group</th>");
        }
        body.push_str(&format!("<td>Row {row:02}</td></tr>"));
    }
    body.push_str("</tbody></table>");
    let bytes = content_epub("en", &body,
        "body,p { margin:0; } table { border-spacing:0; } td,th { padding:2px; border:1px solid black; }", None);
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("open");
    let mut stored = None;
    let mut initial_pages = 0;
    for size in [16.0, 20.0] {
        if size == 20.0 {
            document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("reopen the book");
        }
        let mut config = layout();
        config.viewport_height = 128.0;
        config.page_height = 128.0;
        config.root_font_size = size;
        let revision = document
            .create_revision(&config)
            .expect("paged table revision");
        let engine = revision_by_id(&document, &revision.revision_id).chapter_engine_session();
        let count = engine.metadata().page_count;
        assert!(count > 1, "a 30-row span must not be forced onto one page");
        if size == 16.0 {
            initial_pages = count;
        } else {
            assert_ne!(count, initial_pages, "font change really repaginates");
        }
        let mut occurrences = std::collections::BTreeMap::new();
        let mut target = None;
        for page_index in 0..count {
            for hit in engine.page(page_index).expect("page").targets() {
                if hit.text.starts_with("Row ") || hit.text == "Group" {
                    assert!(
                        hit.bounds.y >= -1e-7
                            && hit.bounds.y + hit.bounds.height <= config.content_height() + 1e-7,
                        "text clipped on page {page_index}: {} at {:?}",
                        hit.text,
                        hit.bounds
                    );
                    *occurrences.entry(hit.text.clone()).or_insert(0) += 1;
                }
                if hit.text == "Row 23" {
                    target = Some((page_index, hit.bounds));
                }
            }
        }
        assert_eq!(occurrences.get("Group"), Some(&1));
        for row in 0..30 {
            assert_eq!(occurrences.get(&format!("Row {row:02}")), Some(&1));
        }
        let (page_index, bounds) = target.expect("resumed page target");
        assert!(page_index > 0);
        let frame = engine
            .frame(page_index, 1.0)
            .expect("paint")
            .expect("frame");
        let painted = frame
            .commands
            .iter()
            .find_map(|command| match command {
                crate::render::DisplayCommand::PaintText(run) if &*run.text == "Row 23" => {
                    Some(run.rect)
                }
                _ => None,
            })
            .expect("the resumed text paints");
        if let Some(stored) = &stored {
            let AnnotationTargetResolution::Exact { target } = document
                .resolve_annotation_target(stored)
                .expect("restore mark")
            else {
                panic!("exact mark")
            };
            let projected = exact_source_range(
                &mut document,
                &revision.revision_id,
                RuntimeExactSourceRangeRequest {
                    href: "chapter.xhtml".to_owned(),
                    source_range: target.source_range,
                },
            )
            .expect("project mark");
            let RuntimeExactSourceRangeResolution::Resolved { range } = projected else {
                panic!("mark on new pages")
            };
            assert_eq!(range.selected_text, "Row 23");
            assert_eq!(range.rects.len(), 1);
            let rect = range.rects[0];
            assert_eq!(rect.page_index, page_index);
            for (actual, expected) in [
                (rect.x, bounds.x),
                (rect.y, bounds.y),
                (rect.width, bounds.width),
            ] {
                assert!(
                    (actual - expected).abs() < 1e-6,
                    "mark remains on the selected run"
                );
            }
            let alignment = paragraph_alignment(&config);
            let relative = [
                rect.x - painted.x + config.margin_left,
                rect.y - painted.y + config.margin_top,
                rect.width - painted.width,
                rect.height - painted.height,
            ];
            for (actual, expected) in relative.into_iter().zip(alignment) {
                assert!(
                    (actual - expected).abs() < 1e-6,
                    "mark must cover the resumed text: {actual} != {expected}; rect {rect:?}, hit {bounds:?}"
                );
            }
        } else {
            let point = |fraction| RuntimeTextPointRequest {
                page_index,
                x: bounds.x + bounds.width * fraction,
                y: bounds.y + bounds.height / 2.0,
            };
            let caret = document
                .resolve_text_caret_in(
                    &revision.revision_id,
                    revision_by_id(&document, &revision.revision_id),
                    point(0.01),
                )
                .expect("caret");
            let RuntimeTextCaretResolution::Resolved { caret } = caret.resolution else {
                panic!("caret")
            };
            let selected = document
                .resolve_text_range_to_point_in(
                    &revision.revision_id,
                    revision_by_id(&document, &revision.revision_id),
                    RuntimeTextRangeToPointRequest {
                        anchor: caret.address,
                        focus: point(0.99),
                    },
                )
                .expect("select");
            let RuntimeTextRangeFromPointsResolution::Resolved { range, .. } = selected.resolution
            else {
                panic!("range")
            };
            assert_eq!(range.selected_text, "Row 23");
            let target = document
                .create_annotation_target(
                    "chapter.xhtml",
                    &range
                        .source_locator
                        .expect("source")
                        .source_range
                        .expect("range"),
                )
                .expect("store mark");
            stored = Some(
                serde_json::from_value(serde_json::to_value(target).expect("serialize mark"))
                    .expect("restore serialized mark"),
            );
        }
    }
}

#[test]
fn rowspan_parallel_text_with_different_line_positions_remains_readable() {
    let span: String = (0..30).map(|row| format!("<p>Span {row:02}</p>")).collect();
    let mut body = format!("<table><tr><td rowspan='30'>{span}</td><td>Row 00</td></tr>");
    for row in 1..30 {
        body.push_str(&format!("<tr><td>Row {row:02}</td></tr>"));
    }
    body.push_str("</table>");
    let bytes = content_epub("en", &body,
        "body,p { margin:0; } table { border-spacing:0; } td { padding:2px; border:1px solid black; vertical-align:top; }", None);
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("open");
    let mut config = layout();
    config.viewport_height = 128.0;
    config.page_height = 128.0;
    config.root_font_size = 20.0;
    let revision = document
        .create_revision(&config)
        .expect("parallel text paginates");
    let engine = revision_by_id(&document, &revision.revision_id).chapter_engine_session();
    let mut occurrences = std::collections::BTreeMap::new();
    for page in 0..engine.metadata().page_count {
        for hit in engine.page(page).expect("page").targets() {
            if hit.text.starts_with("Row ") || hit.text.starts_with("Span ") {
                assert!(
                    hit.bounds.y >= 0.0
                        && hit.bounds.y + hit.bounds.height <= config.content_height() + 1e-7,
                    "parallel text outside page: {}",
                    hit.text
                );
                *occurrences.entry(hit.text).or_insert(0) += 1;
            }
        }
    }
    for prefix in ["Row", "Span"] {
        for row in 0..30 {
            assert_eq!(occurrences.get(&format!("{prefix} {row:02}")), Some(&1));
        }
    }
}

#[test]
fn rowspan_nested_in_a_wrapper_table_keeps_inline_images_and_following_text() {
    use super::fixture::fixture_epub_with_chapter_and_stylesheet;
    let mut body = String::from("<section><table><tr><td><div><table><tr><td rowspan='6'><p>Before</p><p>Lead</p><p><img src='Images/cover.png' style='width:24px;height:36px' alt='plate'/></p><p>After</p></td><td>Row 00</td></tr>");
    for row in 1..6 {
        body.push_str(&format!("<tr><td>Row {row:02}</td></tr>"));
    }
    body.push_str("</table></div></td></tr></table></section><p>Tail</p>");
    let chapter = format!("<html xmlns='http://www.w3.org/1999/xhtml'><body>{body}</body></html>");
    let bytes = fixture_epub_with_chapter_and_stylesheet(chapter.as_bytes(),
        "body,p { margin:0; } table { border-spacing:0; } td { padding:2px; border:1px solid black; vertical-align:top; }");
    let mut document = RuntimeDocument::open_pinned_for_tests(&bytes).expect("open nested table");
    let mut config = layout();
    config.viewport_height = 128.0;
    config.page_height = 128.0;
    let revision = document
        .create_revision(&config)
        .expect("nested table paginates");
    let engine = revision_by_id(&document, &revision.revision_id).chapter_engine_session();
    assert!(engine.metadata().page_count > 1);
    let mut occurrences = std::collections::BTreeMap::new();
    let mut images = 0;
    for page in 0..engine.metadata().page_count {
        let frame = engine.frame(page, 1.0).expect("paint").expect("frame");
        for command in &frame.commands {
            if let crate::render::DisplayCommand::PaintImage { rect, .. } = command {
                images += 1;
                assert_eq!((rect.width, rect.height), (24.0, 36.0));
                assert!(page > 0, "the image really continues onto another page");
                assert!(
                    rect.y >= config.margin_top - 1e-7
                        && rect.y + rect.height <= config.page_height - config.margin_bottom + 1e-7
                );
            }
        }
        for hit in engine.page(page).expect("page").targets() {
            for word in hit.text.split_whitespace() {
                *occurrences.entry(word.to_owned()).or_insert(0) += 1;
            }
        }
    }
    assert_eq!(
        images, 1,
        "image must neither disappear nor repeat on resumed pages"
    );
    for text in ["Before", "Lead", "After", "Tail"] {
        assert_eq!(
            occurrences.get(text),
            Some(&1),
            "missing {text}: {occurrences:?}"
        );
    }
    // The wrapper narrows columns: "Row" and its digits wrap onto separate lines.
    assert_eq!(occurrences.get("Row"), Some(&6));
    for row in 0..6 {
        assert_eq!(
            occurrences.get(&format!("{row:02}")),
            Some(&1),
            "missing row {row}: {occurrences:?}"
        );
    }
}
