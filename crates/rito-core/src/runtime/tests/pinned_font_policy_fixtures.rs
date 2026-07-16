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

pub(super) fn serif_text_font() -> Vec<u8> {
    std::fs::read(workspace_path(
        "apps/reader/src/assets/fonts/Tinos-Regular.ttf",
    ))
    .expect("bundled serif text font reads")
}

pub(super) fn illustration_font() -> Vec<u8> {
    read_font_from_epub(
        "packages/rito/tests/fixtures/books/book-01.epub",
        "OEBPS/Fonts/illus5.ttf",
    )
}

pub(super) fn variable_title_font() -> Vec<u8> {
    append_sfnt_table(&title_font(), *b"fvar", &minimal_fvar_table())
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

fn minimal_fvar_table() -> Vec<u8> {
    let mut table = Vec::new();
    table.extend_from_slice(&0x0001_0000_u32.to_be_bytes());
    table.extend_from_slice(&16_u16.to_be_bytes());
    table.extend_from_slice(&2_u16.to_be_bytes());
    table.extend_from_slice(&1_u16.to_be_bytes());
    table.extend_from_slice(&20_u16.to_be_bytes());
    table.extend_from_slice(&0_u16.to_be_bytes());
    table.extend_from_slice(&8_u16.to_be_bytes());
    table.extend_from_slice(b"wght");
    for value in [100_i32, 400, 900] {
        table.extend_from_slice(&(value << 16).to_be_bytes());
    }
    table.extend_from_slice(&0_u16.to_be_bytes());
    table.extend_from_slice(&256_u16.to_be_bytes());
    table
}

fn append_sfnt_table(font: &[u8], tag: [u8; 4], table: &[u8]) -> Vec<u8> {
    let count = u16::from_be_bytes([font[4], font[5]]) as usize;
    let mut tables = (0..count)
        .map(|index| {
            let record = 12 + index * 16;
            let offset = u32::from_be_bytes(font[record + 8..record + 12].try_into().unwrap());
            let length = u32::from_be_bytes(font[record + 12..record + 16].try_into().unwrap());
            (
                font[record..record + 4].try_into().unwrap(),
                u32::from_be_bytes(font[record + 4..record + 8].try_into().unwrap()),
                font[offset as usize..offset as usize + length as usize].to_vec(),
            )
        })
        .collect::<Vec<([u8; 4], u32, Vec<u8>)>>();
    tables.push((tag, table_checksum(table), table.to_vec()));
    tables.sort_unstable_by_key(|entry| entry.0);
    rebuild_sfnt(&font[..4], tables)
}

fn rebuild_sfnt(scaler: &[u8], tables: Vec<([u8; 4], u32, Vec<u8>)>) -> Vec<u8> {
    let count = tables.len();
    let power = 1_usize << (usize::BITS - count.leading_zeros() - 1);
    let mut output =
        Vec::with_capacity(12 + count * 16 + tables.iter().map(|t| t.2.len()).sum::<usize>());
    output.extend_from_slice(scaler);
    output.extend_from_slice(&(count as u16).to_be_bytes());
    output.extend_from_slice(&((power * 16) as u16).to_be_bytes());
    output.extend_from_slice(&(power.trailing_zeros() as u16).to_be_bytes());
    output.extend_from_slice(&((count * 16 - power * 16) as u16).to_be_bytes());
    output.resize(12 + count * 16, 0);
    for (index, (tag, checksum, bytes)) in tables.into_iter().enumerate() {
        while output.len() % 4 != 0 {
            output.push(0);
        }
        let offset = output.len();
        output.extend_from_slice(&bytes);
        let record = 12 + index * 16;
        output[record..record + 4].copy_from_slice(&tag);
        output[record + 4..record + 8].copy_from_slice(&checksum.to_be_bytes());
        output[record + 8..record + 12].copy_from_slice(&(offset as u32).to_be_bytes());
        output[record + 12..record + 16].copy_from_slice(&(bytes.len() as u32).to_be_bytes());
    }
    output
}

fn table_checksum(table: &[u8]) -> u32 {
    table.chunks(4).fold(0_u32, |sum, chunk| {
        let mut word = [0_u8; 4];
        word[..chunk.len()].copy_from_slice(chunk);
        sum.wrapping_add(u32::from_be_bytes(word))
    })
}
