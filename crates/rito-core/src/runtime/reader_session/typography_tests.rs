//! The reader's typography overrides: how far each reaches, and the bytes a
//! request carries them in.

use crate::runtime::tests::fixture::fixture_epub_with_chapter_and_stylesheet;

use super::{
    convert::layout_config,
    tests::{open_test_session, request},
    *,
};

const SESSION: u64 = 331;

/// A chapter whose every paragraph the book gives its own line height.
fn spaced_paragraphs_epub() -> Vec<u8> {
    let paragraphs = (0..160)
        .map(|index| format!("<p>Paragraph {index} sits on lines the book spaced itself.</p>"))
        .collect::<String>();
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"/></head><body>{paragraphs}</body></html>"#
    );
    fixture_epub_with_chapter_and_stylesheet(chapter.as_bytes(), "p { line-height: 3; }")
}

fn page_count(line_height_override: Option<f64>, line_height_force: bool) -> u32 {
    let mut session = open_test_session(SESSION, spaced_paragraphs_epub()).expect("opens");
    let mut first = request(SESSION, 1, "");
    first.layout.line_height_override = line_height_override;
    first.layout.line_height_force = line_height_force;
    let artifact = session.request_artifact(first).expect("chapter resolves");
    match session
        .resolve_navigation(ReaderNavigationRequest {
            session_id: SESSION,
            query: ReaderNavigationQuery::Layout {
                artifact_id: artifact.artifact_id,
            },
        })
        .expect("layout resolves")
    {
        ReaderNavigationResult::Layout(layout) => layout.page_count,
        other => panic!("a layout answer: {other:?}"),
    }
}

#[test]
fn an_unforced_override_yields_to_the_books_own_declarations() {
    let as_written = page_count(None, false);
    let unforced = page_count(Some(1.0), false);
    let forced = page_count(Some(1.0), true);

    assert!(as_written > 2, "the fixture spans several pages");
    assert_eq!(
        unforced, as_written,
        "the book spaced its paragraphs itself, so an unforced override leaves them"
    );
    assert!(
        forced < as_written,
        "a forced override tightens them: {forced} pages against {as_written}"
    );
}

#[test]
fn a_force_flag_reaches_the_engine_only_with_its_override() {
    let mut layout = request(SESSION, 1, "").layout;
    layout.line_height_force = true;
    layout.font_family_force = true;
    let config = layout_config(layout.clone()).expect("layout converts");
    assert_eq!(config.line_height_force, None);
    assert_eq!(config.font_family_force, None);

    layout.line_height_override = Some(1.5);
    layout.font_family_override = Some("serif".to_owned());
    layout.font_family_force = false;
    let config = layout_config(layout).expect("layout converts");
    assert_eq!(config.line_height_force, Some(true));
    assert_eq!(config.font_family_force, Some(false));
}

fn artifact_request_fixture() -> ReaderArtifactRequest {
    ReaderArtifactRequest {
        session_id: 7,
        request_id: 12,
        layout: ReaderLayout {
            viewport_width: 393.0,
            viewport_height: 760.0,
            margin_top: 24.0,
            margin_right: 20.0,
            margin_bottom: 24.0,
            margin_left: 20.0,
            spread_mode: ReaderSpreadMode::Double,
            first_page_alone: true,
            spread_gap: 20.0,
            root_font_size: 18.0,
            line_height_override: Some(1.5),
            font_family_override: Some("serif".to_owned()),
            line_height_force: false,
            font_family_force: true,
            render_ratio: 3.0,
        },
        locator: ReaderLocator {
            href: "OEBPS/chapter-2.xhtml".to_owned(),
            anchor_id: None,
            source_point: None,
            source_range: None,
            progression: Some(0.25),
        },
        text_profile: ReaderTextRenderingProfile::PlatformStringRuns,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn unhex(hex: &str) -> Vec<u8> {
    (0..hex.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&hex[index..index + 2], 16).expect("hex"))
        .collect()
}

/// Produced by the encoder; the `rito_flutter` and `@ritojs/core-wasm`
/// request wire tests pin the same bytes.
const ARTIFACT_REQUEST_HEX: &str = concat!(
    "5249544f5245513101000000bf0000000000000007000000000000000c000000",
    "00000000620000000000000000000000009078400000000000c0874000000000",
    "0000384000000000000034400000000000003840000000000000344001000000",
    "010000000000003440000000000000324001000000000000f83f010500000073",
    "65726966000000000000084000012500000000000000150000004f454250532f",
    "636861707465722d322e7868746d6c00000001000000000000d03f00000000",
);

#[test]
fn the_artifact_request_wire_is_pinned_byte_for_byte() {
    let bytes = encode_reader_artifact_request(&artifact_request_fixture()).unwrap();
    assert_eq!(hex(&bytes), ARTIFACT_REQUEST_HEX);
    assert_eq!(
        decode_reader_artifact_request(&unhex(ARTIFACT_REQUEST_HEX)),
        Ok(artifact_request_fixture())
    );
    for length in 0..bytes.len() {
        assert!(decode_reader_artifact_request(&bytes[..length]).is_err());
    }
    // The two force flags close the layout record: a record without them
    // is refused rather than read with a default.
    let layout_length = u64::from_le_bytes(bytes[36..44].try_into().unwrap());
    let mut without_flags = bytes.clone();
    let flags_end = 44 + usize::try_from(layout_length).unwrap();
    without_flags.drain(flags_end - 2..flags_end);
    without_flags[36..44].copy_from_slice(&(layout_length - 2).to_le_bytes());
    let total = u64::try_from(without_flags.len()).unwrap();
    without_flags[12..20].copy_from_slice(&total.to_le_bytes());
    assert!(decode_reader_artifact_request(&without_flags).is_err());
}
