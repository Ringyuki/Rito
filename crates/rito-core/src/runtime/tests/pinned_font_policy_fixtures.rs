use std::{
    fs::File,
    io::{Cursor, Read},
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};
use zip::ZipArchive;
use zip::{write::FileOptions, ZipWriter};

use crate::{
    layout::{LayoutConfig, TextMeasurementMode},
    runtime::{
        RuntimePinnedFontFaceInput, RuntimePinnedFontGenericRole, RuntimePinnedFontLanguageTag,
        RuntimePinnedFontPolicyInput,
    },
};

use super::fixture::{add_file, layout};

pub(super) fn policy(faces: Vec<RuntimePinnedFontFaceInput>) -> RuntimePinnedFontPolicyInput {
    RuntimePinnedFontPolicyInput { faces }
}

pub(super) fn face(
    bytes: Vec<u8>,
    generic_role: RuntimePinnedFontGenericRole,
    language: Option<&str>,
) -> RuntimePinnedFontFaceInput {
    RuntimePinnedFontFaceInput {
        expected_sha256: sha256_hex(&bytes),
        bytes,
        generic_role,
        language: language.map(|value| {
            RuntimePinnedFontLanguageTag::parse(value).expect("fixture language is valid")
        }),
    }
}

pub(super) fn title_font() -> Vec<u8> {
    read_font_from_epub("apps/reader/src/assets/demo.epub", "OEBPS/Fonts/title.ttf")
}

pub(super) fn illustration_font() -> Vec<u8> {
    read_font_from_epub(
        "packages/rito/tests/fixtures/books/book-01.epub",
        "OEBPS/Fonts/illus5.ttf",
    )
}

pub(super) fn font_aware_layout() -> LayoutConfig {
    let mut config = layout();
    config.text_measurement = TextMeasurementMode::FontAware;
    config
}

pub(super) fn content_epub(
    language: &str,
    body: &str,
    stylesheet: &str,
    publication_font: Option<&[u8]>,
) -> Vec<u8> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options: FileOptions<'_, ()> = FileOptions::default();
    add_file(
        &mut writer,
        options,
        "META-INF/container.xml",
        br#"<container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OPS/package.opf" media-type="application/oebps-package+xml"/></rootfiles></container>"#,
    );
    let font_manifest = publication_font
        .map(|_| r#"<item id="font" href="book.ttf" media-type="font/ttf"/>"#)
        .unwrap_or_default();
    let package = format!(
        r#"<package version="3.0" xmlns="http://www.idpf.org/2007/opf" unique-identifier="id"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>Pinned</dc:title><dc:language>{language}</dc:language><dc:identifier id="id">pinned</dc:identifier></metadata><manifest><item id="chapter" href="chapter.xhtml" media-type="application/xhtml+xml"/><item id="style" href="style.css" media-type="text/css"/>{font_manifest}</manifest><spine><itemref idref="chapter"/></spine></package>"#
    );
    let chapter = format!(
        r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><link rel="stylesheet" href="style.css"/></head><body>{body}</body></html>"#
    );
    add_file(&mut writer, options, "OPS/package.opf", package.as_bytes());
    add_file(&mut writer, options, "OPS/style.css", stylesheet.as_bytes());
    add_file(
        &mut writer,
        options,
        "OPS/chapter.xhtml",
        chapter.as_bytes(),
    );
    if let Some(bytes) = publication_font {
        add_file(&mut writer, options, "OPS/book.ttf", bytes);
    }
    writer.finish().expect("zip finalizes").into_inner()
}

pub(super) fn unique_supported_character(primary: &[u8], fallback: &[u8]) -> char {
    find_character(|character| {
        !supports_character(primary, character) && supports_character(fallback, character)
    })
    .expect("fixture fonts have a fallback-only glyph")
}

pub(super) fn shared_supported_character(left: &[u8], right: &[u8]) -> char {
    find_character(|character| {
        supports_character(left, character) && supports_character(right, character)
    })
    .expect("fixture fonts share a printable glyph")
}

pub(super) fn xml_text(character: char) -> String {
    match character {
        '&' => "&amp;".to_owned(),
        '<' => "&lt;".to_owned(),
        '>' => "&gt;".to_owned(),
        _ => character.to_string(),
    }
}

fn find_character(predicate: impl Fn(char) -> bool) -> Option<char> {
    [
        0x21..=0x7e,
        0xa0..=0x2fff,
        0x3000..=0x9fff,
        0xe000..=0xf8ff,
        0x10000..=0x1ffff,
    ]
    .into_iter()
    .flatten()
    .filter_map(char::from_u32)
    .find(|character| !character.is_control() && predicate(*character))
}

fn supports_character(bytes: &[u8], character: char) -> bool {
    ttf_parser::Face::parse(bytes, 0)
        .ok()
        .and_then(|face| face.glyph_index(character))
        .is_some_and(|glyph| glyph.0 != 0)
}

fn read_font_from_epub(epub_path: &str, font_path: &str) -> Vec<u8> {
    let fixture = workspace_path(epub_path);
    let file = File::open(&fixture)
        .unwrap_or_else(|error| panic!("fixture opens at {}: {error}", fixture.display()));
    let mut archive = ZipArchive::new(file).expect("fixture is an EPUB archive");
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

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(super) fn short_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .take(8)
        .map(|byte| format!("{byte:02x}"))
        .collect()
}
