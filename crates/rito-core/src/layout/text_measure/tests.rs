use std::{
    fs::File,
    io::Read,
    path::{Path, PathBuf},
};

use ttf_parser::Face;
use zip::ZipArchive;

use super::{
    fixture_character_width, TextMeasurementFontFace, TextMeasurementFonts, TextMeasurementStyle,
};

mod fixture_policy;
mod font_face_selection;
mod font_policy;
mod layout_profile;
mod shape_policy;
mod shape_provenance;
mod shape_safety;
mod work_trace;

fn assert_width(actual: f64, expected: f64) {
    assert!(
        (actual - expected).abs() < 0.000_001,
        "expected width {expected}, got {actual}"
    );
}

fn ordered_face_weights(requested: u16, source_weights: &[u16], bytes: &[u8]) -> Vec<u16> {
    let fonts = TextMeasurementFonts::new(
        source_weights
            .iter()
            .map(|weight| {
                TextMeasurementFontFace::new("Book".to_owned(), None, Some(*weight), bytes)
            })
            .collect(),
    );
    let style = TextMeasurementStyle {
        font_family: Some("Book".to_owned()),
        font_weight: Some(requested),
        ..TextMeasurementStyle::default()
    };

    fonts
        .matching_faces(&style)
        .iter()
        .map(|face| face.weight.expect("test face has an explicit weight"))
        .collect()
}

fn read_epub_font(path: &str) -> Vec<u8> {
    read_font_from_epub("packages/rito/tests/fixtures/books/book-01.epub", path)
}

fn read_demo_epub_font(path: &str) -> Vec<u8> {
    read_font_from_epub("apps/reader/src/assets/demo.epub", path)
}

fn read_font_from_epub(epub_path: &str, font_path: &str) -> Vec<u8> {
    let fixture = workspace_path(epub_path);
    let file = File::open(&fixture)
        .unwrap_or_else(|error| panic!("fixture epub opens at {}: {error}", fixture.display()));
    let mut archive = ZipArchive::new(file).expect("fixture epub is a zip archive");
    let mut font = archive.by_name(font_path).expect("fixture font exists");
    let mut bytes = Vec::new();
    font.read_to_end(&mut bytes).expect("fixture font reads");
    bytes
}

fn workspace_path(relative: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .join(relative)
}

fn font_metric_sample(bytes: &[u8], font_size: f64) -> (char, f64) {
    let face = Face::parse(bytes, 0).expect("fixture font parses");
    (0x20..=0x9fff)
        .filter_map(char::from_u32)
        .find_map(|character| {
            let glyph = face.glyph_index(character)?;
            let advance = face.glyph_hor_advance(glyph)?;
            let width = f64::from(advance) * font_size / f64::from(face.units_per_em());
            if (width - fixture_character_width(character, font_size)).abs() > 0.001 {
                Some((character, width))
            } else {
                None
            }
        })
        .expect("fixture font has a measurable non-fixture glyph")
}

fn supported_character_after(bytes: &[u8], after: char) -> Option<char> {
    let face = Face::parse(bytes, 0).expect("fixture font parses");
    ((after as u32 + 1)..=0x9fff)
        .filter_map(char::from_u32)
        .find(|character| face.glyph_index(*character).is_some())
}

fn character_supported_only_by(preferred: &[u8], fallback: &[u8]) -> char {
    let preferred = Face::parse(preferred, 0).expect("preferred fixture font parses");
    let fallback = Face::parse(fallback, 0).expect("fallback fixture font parses");
    (0x20..=0xffff)
        .filter_map(char::from_u32)
        .find(|character| {
            preferred.glyph_index(*character).is_none()
                && fallback.glyph_index(*character).is_some()
        })
        .expect("fixture fonts have a fallback-only glyph")
}
